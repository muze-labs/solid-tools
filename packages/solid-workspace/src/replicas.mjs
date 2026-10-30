import oldm from '@muze-nl/oldm'
import { copyGraph, mergeGraphs, valueKey } from './graphs.mjs'

const modified = 'http://purl.org/dc/terms/modified'
const deleted = 'https://purl.org/pdsinterop/link-metadata#deleted'

export function isDeleted(subject, context = subject.graph ?? oldm.context()) {
  return Object.hasOwn(subject, deleted)
    || Object.hasOwn(subject, context.propertyName(deleted))
}

// Keep the subject and its facts: deletion invalidates them for normal views,
// but does not destroy the data needed for undo. Return a rollback for failed I/O.
export function markDeleted(subject, now = new Date().toISOString()) {
  const context = subject.graph ?? oldm.context()
  const keys = new Set([deleted, modified,
    context.propertyName(deleted), context.propertyName(modified)])
  const previous = Object.entries(subject)
    .filter(([key]) => keys.has(key))

  function clear() {
    for (const key of Object.keys(subject)) {
      if (keys.has(key)) {
        delete subject[key]
      }
    }
  }

  clear()
  subject[context.propertyName(deleted)] = 'Deleted by the user'
  subject[context.propertyName(modified)] = now

  return () => {
    clear()
    for (const [key, value] of previous) {
      subject[key] = value
    }
  }
}

// Ownership and scalar policy are explicit; no application vocabulary belongs here.
export function mergeReplicas(graphs, {
  scalarPredicates = [], ownedPredicates = [], baseURI, prefixes
} = {}) {
  const copies = graphs.map(graph => copyGraph(graph))
  const snapshots = copies.map(context => {
    const subjects = new Map()
    visit(context.subjects, subject => {
      if (subject.id) {
        subjects.set(subject.id, { subject, context })
      }
    })
    return subjects
  })
  const owners = editOwners(snapshots, ownedPredicates)
  const versions = new Map()
  for (const subjects of snapshots) {
    const groups = new Map()
    for (const [id, candidate] of subjects) {
      const root = editRoot(id, owners)
      if (!groups.has(root)) {
        groups.set(root, new Map())
      }
      groups.get(root).set(id, candidate)
    }
    for (const [root, members] of groups) {
      const candidates = versions.get(root) ?? []
      candidates.push({ root: subjects.get(root), members })
      versions.set(root, candidates)
    }
  }
  const scalars = new Set([modified, deleted, ...scalarPredicates])
  for (const candidates of versions.values()) {
    const dated = candidates.filter(candidate => timestamp(candidate.root) != null)
    if (dated.length === 0) {
      continue
    }
    dated.sort((left, right) => timestamp(left.root) - timestamp(right.root)
      || Number(isDeleted(left.root.subject, left.root.context))
      - Number(isDeleted(right.root.subject, right.root.context))
      || revisionKey(left, scalars).localeCompare(revisionKey(right, scalars)))
    const winner = dated.at(-1)
    // Capture before modifying any candidate, including the winning graph.
    const selected = new Map([...winner.members].map(([id, member]) => [
      id, Object.entries(member.subject)
        .map(([key, value]) => [predicateIRI(key, member), value])
        .filter(([iri]) => scalars.has(iri))
    ]))
    for (const candidate of candidates) {
      for (const [id, member] of candidate.members) {
        for (const key of Object.keys(member.subject)) {
          if (scalars.has(predicateIRI(key, member))) {
            delete member.subject[key]
          }
        }
        for (const [iri, value] of selected.get(id) ?? []) {
          member.subject[member.context.propertyName(iri)] = value
        }
      }
    }
  }
  return mergeGraphs(copies, { baseURI, prefixes })
}

function editOwners(snapshots, predicates) {
  const owners = new Map()
  for (const subjects of snapshots) {
    for (const [id, candidate] of subjects) {
      for (const predicate of predicates) {
        for (const child of values(field(candidate, predicate))) {
          // rdf:nil represents an empty Collection, not a shared owned subject.
          if (child?.id === 'http://www.w3.org/1999/02/22-rdf-syntax-ns#nil') {
            continue
          }
          if (!(child instanceof oldm.NamedNode)) {
            throw new TypeError('solid-workspace: owned links must reference named subjects')
          }
          const parent = owners.get(child.id)
          if (parent && parent !== id) {
            throw new Error(`solid-workspace: multiple owners for ${child.id}`)
          }
          owners.set(child.id, id)
        }
      }
    }
  }
  return owners
}

function editRoot(id, owners) {
  const visited = new Set()
  while (owners.has(id)) {
    if (visited.has(id)) {
      throw new Error(`solid-workspace: ownership cycle at ${id}`)
    }
    visited.add(id)
    id = owners.get(id)
  }
  return id
}

function revisionKey(candidate, scalars) {
  return JSON.stringify([...candidate.members].sort(([a], [b]) => a.localeCompare(b))
    .map(([id, member]) => [id, scalarKey(member, scalars)]))
}

function values(value) {
  return Array.isArray(value) ? value : value == null ? [] : [value]
}

function predicateIRI(key, { context }) {
  if (key === 'id') return key
  return key === 'a' ? 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type' : context.fullURI(key)
}

function field(candidate, iri) {
  if (!candidate) {
    return undefined
  }
  return Object.entries(candidate.subject).find(([key]) => predicateIRI(key, candidate) === iri)?.[1]
}

function timestamp(candidate) {
  const times = values(field(candidate, modified)).map(value => Date.parse(String(value))).filter(Number.isFinite)
  return times.length ? Math.max(...times) : null
}

function scalarKey(candidate, scalars) {
  return JSON.stringify([...scalars].sort().map(iri => {
    const value = field(candidate, iri)
    return valueKey(value)
  }))
}

function visit(value, fn, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || value instanceof String || value instanceof Number || value instanceof Boolean || seen.has(value)) return
  seen.add(value)
  fn(value)
  for (const item of Object.values(value)) visit(item, fn, seen)
}
