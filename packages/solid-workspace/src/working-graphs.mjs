import * as assert from '@muze-nl/assert'
import { copyGraph, emptyGraph, writeSubjectToGraph } from './graphs.mjs'
import { recordSourceId } from './sources.mjs'

// Owns the association between installed OLDM graphs and source metadata.
// Transport and replica policy never modify the graph/source indexes directly.
export class WorkingGraphs {
  #graphSources
  #records
  #objects

  constructor(context) {
    this.context = context
    this.#graphSources = new Map()
    this.#records = []
    this.#objects = new WeakMap()
  }

  graph(source) {
    return this.context.graph(source.url) ?? null
  }

  snapshot(url) {
    return copyGraph(this.context.graph(url))
  }

  replaceSource(descriptor) {
    for (const [url, owner] of this.#graphSources) {
      if (recordSourceId({ source: owner }) === descriptor.id) {
        const source = owner.parent
          ? { ...owner, parent: descriptor, readOnly: descriptor.readOnly }
          : descriptor
        this.#graphSources.set(url, source)
      }
    }
    for (const record of this.#records) {
      const source = this.#graphSources.get(record.sourceUrl)
      if (source) {
        record.source = source
        record.sourceId = recordSourceId(record)
        record.readOnly = Boolean(source.readOnly)
      }
    }
  }

  installGraph(source, snapshot) {
    const options = {
      context: this.context,
      url: source.url,
      baseURI: source.baseURI,
      prefixes: { ...snapshot?.prefixDeclarations(), ...source.prefixes }
    }
    const graph = snapshot ? copyGraph(snapshot, options) : emptyGraph({
      ...options, prefixes: source.prefixes
    })
    this.context.addGraph(graph)
    this.#graphSources.set(graph.url, source)
    this.refreshGraphRecords(graph, source)
    return graph
  }

  refreshGraphRecords(graph, source) {
    const retained = new Map(this.#records
      .filter(record => record.sourceUrl === graph.url)
      .map(record => [record.object, record]))
    this.#records = this.#records.filter(record => record.sourceUrl !== graph.url)
    this.#objects = new WeakMap()
    for (const record of this.#records) {
      this.#objects.set(record.object, record)
    }
    for (const object of graph.data) {
      if (Object.keys(object).length > 1) {
        const record = retained.get(object)
        if (record) {
          record.source = source
          this.#records.push(record)
          this.#objects.set(object, record)
        }
        else {
          this.track(object, {
            source, sourceUrl: graph.url, data: graph, status: 'loaded'
          })
        }
      }
    }
  }

  clearSourceGraphs(source) {
    for (const [url, owner] of this.#graphSources) {
      if (recordSourceId({ source: owner }) === source.id) {
        this.installGraph(owner, null)
        this.#graphSources.delete(url)
      }
    }
  }

  recordFor(object) {
    const graph = object?.graph
    if (!graph || this.context.graph(graph.url) !== graph) {
      return null
    }
    const source = this.#graphSources.get(graph.url)
    if (!source || graph.get(object.id) !== object) {
      return null
    }
    return this.#objects.get(object) ?? this.track(object, {
      source, sourceUrl: graph.url, data: graph, status: 'loaded'
    })
  }

  track(object, options = {}) {
    assert.check(object, Object, 'solid-workspace: can only track object values', TypeError)

    const record = {
      object,
      source: options.source ?? null,
      sourceId: recordSourceId(options),
      sourceUrl: options.sourceUrl ?? options.source?.url ?? object.id ?? null,
      data: options.data ?? null,
      response: options.response ?? null,
      status: options.status ?? 'loaded',
      readOnly: Boolean(options.readOnly ?? options.source?.readOnly),
      created: Boolean(options.created),
      deleted: Boolean(options.deleted),
      error: null
    }

    this.#records.push(record)
    this.#objects.set(object, record)
    return record
  }

  sourcesOf(object, predicate, value) {
    let graphs
    if (arguments.length < 3) {
      graphs = this.context.sources(object, predicate)
    }
    else {
      graphs = this.context.sources(object, predicate, value)
    }
    return graphs.map(graph => ({
      sourceUrl: graph.url,
      source: this.#graphSources.get(graph.url) ?? null,
      record: this.#records.find(record => (
        record.sourceUrl === graph.url && record.object.id === object.id
      )) ?? null
    }))
  }

  subjects(ids) {
    const subjects = []
    for (const [url, source] of this.#graphSources) {
      if (ids.size === 0 || ids.has(recordSourceId({ source }))) {
        const graph = this.context.graph(url)
        for (const object of graph.data) {
          if (Object.keys(object).length > 1) {
            subjects.push(object)
          }
        }
      }
    }
    return subjects
  }

  create(descriptor, object) {
    let source = descriptor
    if (descriptor.kind === 'container') {
      source = {
        ...descriptor,
        kind: 'resource',
        url: `urn:solid-workspace:new:${globalThis.crypto.randomUUID()}`,
        parent: descriptor,
        createContainer: descriptor.url
      }
    }
    let graph = this.context.graph(source.url)
    if (!graph) {
      graph = this.installGraph(source, null)
    }
    const node = writeSubjectToGraph({
      graph,
      subject: object,
      id: object.id ?? `urn:uuid:${globalThis.crypto.randomUUID()}`
    })
    this.refreshGraphRecords(graph, source)
    const record = this.#objects.get(node) ?? this.track(node, {
      source, sourceUrl: graph.url, data: graph
    })
    record.status = 'new'
    record.created = true
    return node
  }

  relocate(record, location) {
    const previous = record.source
    const source = { ...previous, url: location }
    delete source.createContainer
    const graph = this.context.graph(previous.url)
    this.installGraph(previous, null)
    this.#graphSources.delete(previous.url)
    graph.url = source.url
    graph.baseURI = source.url.split('#')[0]
    this.context.addGraph(graph)
    this.#graphSources.set(source.url, source)
    record.source = source
    record.sourceUrl = source.url
    this.#records.push(record)
    this.#objects.set(record.object, record)
  }
}
