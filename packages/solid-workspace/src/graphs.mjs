import oldm from '@muze-nl/oldm'
const { BlankNode, Collection } = oldm

export function emptyGraph({
  context = oldm.context(), url = `urn:uuid:${globalThis.crypto.randomUUID()}`,
  prefixes = {}
} = {}) {
  return new oldm.Graph([], url, 'text/turtle', prefixes, context)
}

export function parseGraph(turtle, { url, prefixes = {} } = {}) {
  if (typeof turtle !== 'string') {
    throw new TypeError('solid-workspace: expected Turtle text')
  }
  return oldm.context({ prefixes }).parse(turtle, url, 'text/turtle')
}

// A detached native graph captures an admitted save or a tentative replica merge.
// Only the workspace publishes it into the live context after I/O succeeds.
export function copyGraph(source, options = {}) {
  if (!(source instanceof oldm.Graph)) {
    throw new TypeError('solid-workspace: expected an OLDM Graph')
  }
  const graph = emptyGraph({
    url: source.url,
    prefixes: source.prefixDeclarations(),
    ...options
  })
  importGraph(graph, source)
  return graph
}

export function mergeGraphs(sources) {
  const graph = emptyGraph({ prefixes: sources[0]?.prefixDeclarations() })
  for (const source of sources) {
    importGraph(graph, source)
  }
  return graph
}

function importGraph(graph, source) {
  const copied = new WeakMap()
  for (const subject of source.data) {
    writeSubjectToGraph({ graph, subject, copied })
  }
}

export function isObject(value) {
  return Boolean(value && typeof value === 'object'
    && !Array.isArray(value) && !isPrimitiveWrapper(value))
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

export function writeSubjectToGraph({
  graph, subject, id = subject.id, copied = new WeakMap(), replace = false
}) {
  if (copied.has(subject)) {
    return copied.get(subject)
  }
  const node = id ? graph.addNamedNode(id) : new BlankNode(graph)
  copied.set(subject, node)
  for (const [predicate, value] of Object.entries(subject)) {
    if (predicate === 'id') {
      continue
    }
    const name = predicate === 'a'
      ? 'a' : subject.graph?.fullURI(predicate) ?? predicate
    const imported = graphValueFromObjectValue({ graph, value, copied, replace })
    if (replace || (Array.isArray(value) && value.length === 0)) {
      graph.set(node, name, imported)
    }
    else {
      graph.add(node, name, imported)
    }
  }
  return node
}

function graphValueFromObjectValue({ graph, value, copied, replace = false }) {
  if (value instanceof String || value instanceof Number) {
    return oldm.literal(value)
  }
  if (value instanceof Boolean) {
    return Object.assign(new Boolean(value.valueOf()), value)
  }
  if (value instanceof Collection) {
    if (copied.has(value)) {
      return copied.get(value)
    }
    const list = new Collection(graph)
    copied.set(value, list)
    for (const item of value) {
      list.push(graphValueFromObjectValue({
        graph, value: item, copied, replace
      }))
    }
    return list
  }
  if (Array.isArray(value)) {
    return value.map(item => graphValueFromObjectValue({
      graph, value: item, copied, replace
    }))
  }
  if (isObject(value)) {
    if (value.id || value instanceof BlankNode) {
      return writeSubjectToGraph({ graph, subject: value, copied, replace })
    }
    throw new TypeError(
      'solid-workspace: RDF objects need an id or an OLDM BlankNode; '
      + 'encode application literals explicitly'
    )
  }
  return value
}
