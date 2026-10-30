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

// Replica policy is separate from additive graph import. The caller declares
// scalar predicates; this module has no annotation or editor vocabulary.
export function mergeReplicas(graphs, { scalarPredicates = [] } = {}) {
  const copies = graphs.map(graph => copyGraph(graph))
  const versions = new Map()
  for (const graph of copies) {
    const context = graph
    visit(graph.subjects, subject => {
      if (!subject.id) return
      const candidates = versions.get(subject.id) ?? []
      candidates.push({ subject, context: subject.graph ?? context })
      versions.set(subject.id, candidates)
    })
  }
  const scalars = new Set([modified, deleted, ...scalarPredicates])
  for (const candidates of versions.values()) {
    const dated = candidates.filter(candidate => timestamp(candidate) != null)
    if (dated.length === 0) continue
    dated.sort((left, right) => timestamp(left) - timestamp(right)
      || Number(isDeleted(left.subject, left.context))
      - Number(isDeleted(right.subject, right.context))
      || scalarKey(left, scalars).localeCompare(scalarKey(right, scalars)))
    const winner = dated.at(-1)
    const selected = new Map(Object.entries(winner.subject)
      .map(([key, value]) => [predicateIRI(key, winner), { key, value }])
      .filter(([iri]) => scalars.has(iri)))
    for (const candidate of candidates) {
      for (const key of Object.keys(candidate.subject)) {
        if (scalars.has(predicateIRI(key, candidate))) delete candidate.subject[key]
      }
      for (const [iri, { key, value }] of selected) {
        candidate.subject[candidate.subject.graph?.propertyName(iri) ?? key] = value
      }
    }
  }
  return mergeGraphs(copies)
}

function values(value) {
  return Array.isArray(value) ? value : value == null ? [] : [value]
}

function predicateIRI(key, { context }) {
  if (key === 'id') return key
  return key === 'a' ? 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type' : context.fullURI(key)
}

function field(candidate, iri) {
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
