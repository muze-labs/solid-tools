import oldm from '@muze-nl/oldm'
import * as assert from '@muze-nl/assert'

export function mergeGraphDocuments(documents = [], options = {}) {
  assert.check(documents, Array, 'solid-workspace: graph documents must be an array', TypeError)

  const base = graphDocumentFrom(documents[0])
  const merged = {
    format: options.format ?? base.format,
    version: options.version ?? base.version,
    prefixes: {},
    subjects: []
  }
  const subjectsById = new Map()

  for (const document of documents.map(graphDocumentFrom)) {
    Object.assign(merged.prefixes, document.prefixes)

    for (const subject of document.subjects) {
      if (!subject?.id) continue

      const current = subjectsById.get(subject.id)
      if (!current) {
        const clone = cloneValue(subject)
        subjectsById.set(subject.id, clone)
        merged.subjects.push(clone)
        continue
      }

      mergeSubject(current, subject)
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

  return target
}

export function graphDocumentFrom(value, options = {}) {
  if (!value) {
    return {
      format: null,
      version: null,
      prefixes: {},
      subjects: []
    }
  }

  if (typeof value === 'string' || value instanceof String) {
    return graphDocumentFromTurtle(value, options)
  }

  const subjects = oldm.subjects(value)

  if (Array.isArray(value)) {
    return {
      format: null,
      version: null,
      prefixes: {},
      subjects
    }
  }

  if (
    Object.hasOwn(value, 'format')
    || Object.hasOwn(value, 'version')
    || Object.hasOwn(value, 'prefixes')
    || Object.hasOwn(value, 'subjects')
    || Object.hasOwn(value, 'data')
    || Object.hasOwn(value, 'primary')
  ) {
    return {
      format: value.format ?? null,
      version: value.version ?? null,
      prefixes: value.prefixes ?? {},
      subjects
    }
  }

  return {
    format: null,
    version: null,
    prefixes: {},
    subjects
  }
}

export function cloneGraphDocument(document) {
  const graphDocument = graphDocumentFrom(document)
  return {
    ...graphDocument,
    prefixes: cloneValue(graphDocument.prefixes),
    subjects: cloneValue(graphDocument.subjects)
  }
}

export function graphDocumentFromTurtle(turtle, options = {}) {
  const context = oldm.context({
    defaultGraph: options.url,
    prefixes: options.prefixes ?? {}
  })
  const document = graphDocumentFrom(context.parse(String(turtle), options.url, 'text/turtle'))
  return {
    ...document,
    subjects: document.subjects
      .filter(subject => Object.keys(subject).length > 1)
  }
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

  for (const subject of graphDocument.subjects) {
    writeSubjectToGraph({ graph, subject })
  }

  return graph.write()
}

export function cloneValue(value) {
  if (Array.isArray(value)) {
    return value.map(cloneValue)
  }

  if (isPrimitiveWrapper(value)) {
    return clonePrimitiveWrapper(value)
  }

  if (isObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, cloneValue(item)])
    )
  }

  return value
}

export function isObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && !isPrimitiveWrapper(value))
}

function mergeSubject(target, incoming) {
  for (const [predicate, value] of Object.entries(incoming)) {
    if (predicate === 'id') continue

    if (!Object.hasOwn(target, predicate)) {
      target[predicate] = cloneValue(value)
      continue
    }

    target[predicate] = mergeValues(target[predicate], value)
  }

  return target
}

function mergeValues(left, right) {
  if (valueEquals(left, right)) {
    return left
  }

  if (isObject(left) && isObject(right) && left.id && left.id === right.id) {
    return mergeSubject(left, right)
  }

  const values = []
  for (const item of [...arrayValues(left), ...arrayValues(right)]) {
    if (!values.some(existing => valueEquals(existing, item))) {
      values.push(cloneValue(item))
    }
  }

  return values.length === 1 ? values[0] : values
}

function arrayValues(value) {
  return Array.isArray(value) ? value : [value]
}

function valueEquals(left, right) {
  return valueKey(left) === valueKey(right)
}

function valueKey(value) {
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

function sortObject(value) {
  if (Array.isArray(value)) {
    return value.map(sortObject)
  }

  if (!isObject(value)) {
    return value
  }

  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, sortObject(item)])
  )
}

function isPrimitiveWrapper(value) {
  return value instanceof String || value instanceof Number || value instanceof Boolean
}

function clonePrimitiveWrapper(value) {
  const clone = new value.constructor(value.valueOf())

  for (const [key, item] of Object.entries(value)) {
    if (!/^\d+$/.test(key)) {
      clone[key] = cloneValue(item)
    }
  }

  return clone
}

function primitiveWrapperData(value) {
  const data = {
    value: value.valueOf()
  }

  for (const [key, item] of Object.entries(value)) {
    if (!/^\d+$/.test(key)) {
      if (value instanceof String && key === 'type' && item === 'xsd$string') {
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
    subjects: document.subjects ?? []
  }
}

function writeSubjectToGraph({ graph, subject }) {
  if (!subject?.id) return null

  for (const [predicate, value] of Object.entries(subject)) {
    if (predicate === 'id') continue

    graph.set(subject.id, predicate, graphValueFromObjectValue({ graph, value }))
  }

  return subject.id
}

function graphValueFromObjectValue({ graph, value }) {
  if (Array.isArray(value)) {
    return value.map(item => graphValueFromObjectValue({ graph, value: item }))
  }

  if (isObject(value)) {
    if (value.id) {
      writeSubjectToGraph({ graph, subject: value })
      return value.id
    }

    return JSON.stringify(value)
  }

  return value
}
