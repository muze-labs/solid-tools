import oldm from '@muze-nl/oldm'
const { BlankNode, NamedNode, Collection } = oldm
import * as assert from '@muze-nl/assert'

export function mergeGraphDocuments(documents = [], options = {}) {
  assert.check(documents, Array, 'solid-workspace: graph documents must be an array', TypeError)

  const base = graphDocumentFrom(documents[0])
  const merged = {
    format: options.format ?? base.format,
    version: options.version ?? base.version,
    prefixes: {},
    subjects: {}
  }
  const subjectsById = new Map()
  const copies = new WeakMap()
  const pairs = new WeakMap()

  for (const document of documents.map(graphDocumentFrom)) {
    Object.assign(merged.prefixes, document.prefixes)

    for (const subject of document.data) {
      if (!subject?.id) continue

      const current = subjectsById.get(subject.id)
      if (!current) {
        const clone = cloneValue(subject, copies)
        subjectsById.set(subject.id, clone)
        merged.subjects[clone.id] = clone
        continue
      }

      mergeSubject(current, subject, pairs)
    }
  }

  const target = {
    ...merged,
    changed: !graphDocumentsEqual(base, merged)
  }

  if (Object.keys(target.prefixes).length === 0) {
    delete target.prefixes
  }

  if (target.format == null) delete target.format
  if (target.version == null) delete target.version

  return withData(target)
}

export function graphDocumentFrom(value, options = {}) {
  if (!value) {
    return withData({
      format: null,
      version: null,
      prefixes: {},
      subjects: {}
    })
  }

  if (typeof value === 'string' || value instanceof String) {
    return graphDocumentFromTurtle(value, options)
  }

  if (Array.isArray(value)) {
    return withData({
      format: null,
      version: null,
      prefixes: {},
      subjects: subjectsFromArray(value)
    })
  }

  let subjects = {}
  if (Array.isArray(value.subjects)) {
    throw new TypeError('solid-workspace: graph document subjects must be an object map')
  }
  if (value.subjects && typeof value.subjects === 'object') {
    subjects = value.subjects
  }

  if (
    Object.hasOwn(value, 'format')
    || Object.hasOwn(value, 'version')
    || Object.hasOwn(value, 'prefixes')
    || Object.hasOwn(value, 'subjects')
  ) {
    return withData({
      format: value.format ?? null,
      version: value.version ?? null,
      prefixes: value.prefixes ?? {},
      subjects
    })
  }

  return withData({
    format: null,
    version: null,
    prefixes: {},
    subjects
  })
}

export function cloneGraphDocument(document) {
  const graphDocument = graphDocumentFrom(document)
  return withData({
    ...graphDocument,
    prefixes: cloneValue(graphDocument.prefixes),
    subjects: cloneValue(graphDocument.subjects)
  })
}

export function graphDocumentFromTurtle(turtle, options = {}) {
  const context = oldm.context({
    defaultGraph: options.url,
    prefixes: options.prefixes ?? {}
  })
  const document = graphDocumentFrom(context.parse(String(turtle), options.url, 'text/turtle'))
  return withData({
    ...document,
    subjects: subjectsFromArray(document.data
      .filter(subject => Object.keys(subject).length > 1)
    )
  })
}

export async function graphDocumentToTurtle(document, options = {}) {
  const graphDocument = graphDocumentFrom(document)
  const context = oldm.context({
    defaultGraph: options.url,
    prefixes: {
      ...graphDocument.prefixes,
      ...options.prefixes
    }
  })
  const graph = context.parse('', options.url, 'text/turtle')

  const copied = new WeakMap()
  for (const subject of graphDocument.data) {
    writeSubjectToGraph({ graph, subject, copied })
  }

  return graph.write()
}

export function cloneValue(value, copied = new WeakMap()) {
  if (!value || typeof value !== 'object') return value
  if (copied.has(value)) return copied.get(value)

  let clone
  if (value instanceof Collection) clone = new Collection(value.graph)
  else if (Array.isArray(value)) clone = []
  else if (value instanceof NamedNode) clone = new NamedNode(value.id, value.graph)
  else if (value instanceof BlankNode) clone = new BlankNode(value.graph)
  else if (isPrimitiveWrapper(value)) clone = new value.constructor(value.valueOf())
  else clone = {}
  copied.set(value, clone)
  for (const [key, item] of Object.entries(value)) {
    if (value instanceof NamedNode && key === 'id') continue
    if (value instanceof String && /^\d+$/.test(key)) continue
    clone[key] = cloneValue(item, copied)
  }
  return clone
}

export function isObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && !isPrimitiveWrapper(value))
}

function mergeSubject(target, incoming, pairs = new WeakMap()) {
  const seen = pairs.get(target) ?? new WeakSet()
  if (seen.has(incoming)) return target
  seen.add(incoming)
  pairs.set(target, seen)
  for (const [predicate, value] of Object.entries(incoming)) {
    if (predicate === 'id') continue

    if (!Object.hasOwn(target, predicate)) {
      target[predicate] = cloneValue(value)
      continue
    }

    target[predicate] = mergeValues(target[predicate], value, pairs)
  }

  return target
}

function mergeValues(left, right, pairs) {
  if (isObject(left) && isObject(right) && left.id && left.id === right.id) {
    return mergeSubject(left, right, pairs)
  }
  if (valueEquals(left, right)) return left

  const values = []
  for (const item of [...arrayValues(left), ...arrayValues(right)]) {
    if (!values.some(existing => valueEquals(existing, item))) {
      values.push(cloneValue(item))
    }
  }

  return values.length === 1 ? values[0] : values
}

function arrayValues(value) {
  return Array.isArray(value) && !(value instanceof Collection) ? value : [value]
}

function valueEquals(left, right) {
  return valueKey(left) === valueKey(right)
}

export function valueKey(value) {
  if (value instanceof Collection) return `list:${JSON.stringify(sortObject(value))}`
  if (isPrimitiveWrapper(value)) {
    return `literal:${JSON.stringify(sortObject(primitiveWrapperData(value)))}`
  }

  if (isObject(value)) {
    return value.id ? `id:${value.id}` : `json:${JSON.stringify(sortObject(value))}`
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return `literal:${JSON.stringify({ value })}`
  }

  return `${typeof value}:${String(value)}`
}

function sortObject(value, seen = new Map()) {
  if (isPrimitiveWrapper(value)) return { literal: primitiveWrapperData(value) }
  if (!value || typeof value !== 'object') return value
  if (seen.has(value)) return { reference: seen.get(value) }
  seen.set(value, value.id ?? seen.size)
  if (Array.isArray(value)) {
    const items = Array.from(value, item => sortObject(item, seen))
    return value instanceof Collection ? { list: items } : items
  }
  return Object.fromEntries(Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => [key, sortObject(item, seen)]))
}

function isPrimitiveWrapper(value) {
  return value instanceof String || value instanceof Number || value instanceof Boolean
}

function primitiveWrapperData(value) {
  const data = {
    value: value.valueOf()
  }

  for (const [key, item] of Object.entries(value)) {
    if (!/^\d+$/.test(key)) {
      if (value instanceof String && key === 'type' && item === 'http://www.w3.org/2001/XMLSchema#string') {
        continue
      }
      data[key] = item
    }
  }

  return data
}

function graphDocumentsEqual(left, right) {
  return JSON.stringify(sortObject(graphDocumentComparable(left))) === JSON.stringify(sortObject(graphDocumentComparable(right)))
}

function graphDocumentComparable(document) {
  return {
    format: document.format ?? null,
    version: document.version ?? null,
    prefixes: document.prefixes ?? {},
    subjects: Object.values(document.subjects ?? {})
  }
}

function withData(document) {
  Object.defineProperty(document, 'data', {
    get() {
      return Object.values(this.subjects)
    },
    enumerable: false
  })
  return document
}

function subjectsFromArray(subjects) {
  const result = {}
  for (const subject of subjects) {
    if (subject?.id) {
      result[subject.id] = subject
    }
  }
  return result
}

function writeSubjectToGraph({ graph, subject, copied }) {
  if (copied.has(subject)) return copied.get(subject)
  const node = subject.id ? graph.addNamedNode(subject.id) : new BlankNode(graph)
  copied.set(subject, node)
  for (const [predicate, value] of Object.entries(subject)) {
    if (predicate === 'id') continue
    const name = predicate === 'a' ? 'a' : subject.graph?.fullURI(predicate) ?? predicate
    graph.add(node, name, graphValueFromObjectValue({ graph, value, copied }))
  }
  return node
}

function graphValueFromObjectValue({ graph, value, copied }) {
  if (value instanceof Collection) {
    if (copied.has(value)) return copied.get(value)
    const list = new Collection(graph)
    copied.set(value, list)
    for (const item of value) list.push(graphValueFromObjectValue({ graph, value: item, copied }))
    return list
  }
  if (Array.isArray(value)) {
    return value.map(item => graphValueFromObjectValue({ graph, value: item, copied }))
  }
  if (isObject(value)) {
    if (value.id || value instanceof BlankNode) {
      return writeSubjectToGraph({ graph, subject: value, copied })
    }
    // Legacy application JSON values (for example editor fragments) remain literals.
    return JSON.stringify(value)
  }
  return value
}
