import oldm from '@muze-nl/oldm'
import * as assert from '@muze-nl/assert'
import { WorkspaceCollection } from './collection.mjs'
import { WorkspaceSources, resourceSources } from './sources.mjs'
import { WorkingGraphs } from './working-graphs.mjs'
import { SourceIO } from './source-io.mjs'
import { WorkspaceStatus, sourceFailureState, workspaceState } from './status.mjs'
import { ResourceOperations } from './operations.mjs'
import { ReplicaSync } from './replica-sync.mjs'
import { WorkspaceWrites } from './writes.mjs'
import { isObject } from './graphs.mjs'

export function workspace(options = {}) {
  return new SolidWorkspace(options)
}

export class SolidWorkspace {
  #sources
  #graphs
  #io
  #state
  #replicas
  #writes

  constructor(options = {}) {
    assert.check(options, Object, 'solid-workspace: workspace options must be an object', TypeError)
    this.#sources = new WorkspaceSources()
    this.#graphs = new WorkingGraphs(options.context ?? oldm.context(options))
    this.#state = new WorkspaceStatus()
    this.#io = new SourceIO(options.solid, this)
    const dependencies = {
      graphs: this.#graphs,
      io: this.#io,
      state: this.#state,
      operations: new ResourceOperations()
    }
    this.#replicas = new ReplicaSync(dependencies)
    this.#writes = new WorkspaceWrites({ ...dependencies, sources: this.#sources })
    if (options.sources) {
      this.addSource(options.sources)
    }
    if (options.resources) {
      this.add(options.resources)
    }
    this.collections = Object.fromEntries(
      Object.entries(options.collections ?? {}).map(([name, descriptor]) => [
        name,
        new WorkspaceCollection(this, name, descriptor)
      ])
    )
  }

  get context() {
    return this.#graphs.context
  }

  get status() {
    return this.#state.value
  }

  get sources() {
    return this.#sources.sources
  }

  get resources() {
    return this.#sources.resources
  }

  get solid() {
    return this.#io.solid
  }


  add(part) {
    if (Array.isArray(part)) {
      for (const item of part) {
        this.add(item)
      }
      return this
    }

    if (part?.workspacePart === 'source') {
      this.addSource(part)
      return this
    }

    if (part?.workspacePart === 'resource') {
      this.addResource(part)
      return this
    }

    if (part?.workspacePart === 'client') {
      this.setClient(part.client)
      return this
    }

    throw new TypeError('solid-workspace: add() expects a workspace part from a factory')
  }

  addSource(sourceOrSources) {
    const sources = this.#sources.add(sourceOrSources)
    for (const source of sources) {
      this.#acceptSource(source)
    }
    return sources.length === 1 ? sources[0] : sources
  }

  #acceptSource(source) {
    this.#graphs.replaceSource(source)
    this.#state.source(source, this.status.sources[source.id] ?? { state: 'idle' })
  }

  addResource(part) {
    const resource = this.#sources.addResource(part)
    for (const source of resourceSources(resource)) {
      this.#acceptSource(source)
    }
    this.#state.resource(resource)
    return resource
  }

  setClient(client) {
    this.#io.solid = client
    return this
  }

  async open(options = {}) {
    if (this.#sources.isResource(options)) {
      return this.openResource(options)
    }

    if (isOpenAllOptions(options) && this.resources.length > 0) {
      const resourceSourceIds = new Set(this.resources.flatMap(item => (
        resourceSources(item).map(source => source.id)
      )))
      for (const item of this.resources) {
        await this.openResource(item, options)
      }
      const directSources = this.sources.filter(source => !resourceSourceIds.has(source.id))
      if (directSources.length > 0) {
        await this.load({
          ...options,
          sources: directSources,
          throwOnError: options.throwOnError ?? false
        })
      }
      return this
    }

    if (Array.isArray(options) && options.some(item => this.#sources.isResource(item))) {
      for (const item of options) {
        if (this.#sources.isResource(item)) {
          await this.openResource(item)
        }
        else {
          await this.load({ sources: item, throwOnError: false })
        }
      }
      return this
    }

    if (options?.resources) {
      const resources = Array.isArray(options.resources) ? options.resources : [options.resources]
      for (const item of resources) {
        await this.openResource(item, options)
      }
      return this
    }

    if (
      typeof options === 'string'
      || Array.isArray(options)
      || options?.workspacePart === 'source'
    ) {
      return this.load({ sources: options, throwOnError: false })
    }

    return this.load({
      throwOnError: false,
      ...options
    })
  }

  async openResource(resourceOrId, options = {}) {
    const resource = this.#sources.resolveResource(resourceOrId)
    await this.#replicas.open(resource, options)
    return this
  }

  async load(options = {}) {
    const sources = this.#sources.resolveSources(options.sources ?? this.sources)
    const failures = []
    const loaded = []
    const throwOnError = options.throwOnError ?? true

    this.status.state = 'opening'
    this.status.error = null

    for (const source of sources) {
      try {
        loaded.push(await this.loadSource(source))
      }
      catch (error) {
        failures.push({ source, error })
        if (throwOnError) {
          this.status.state = 'error'
          this.status.error = error
          throw error
        }
      }
    }

    this.status.lastOpen = { sources, loaded, failures }
    this.status.state = workspaceState(this.status)
    this.status.error = failures[0]?.error ?? null
    return this
  }

  async loadSource(sourceOrId) {
    const descriptor = this.#sources.resolveSource(sourceOrId)
    this.#state.source(descriptor, { state: 'opening', error: null })

    try {
      if (descriptor.kind === 'container') {
        const entries = await this.#io.contains(descriptor)
        this.#graphs.clearSourceGraphs(descriptor)

        for (const entry of entries) {
          await this.loadSource({
            ...descriptor,
            append: true,
            kind: 'resource',
            url: entry.url,
            parent: descriptor
          })
        }

        this.#state.source(descriptor, { state: 'ready', error: null })
        return entries
      }

      const snapshot = await this.#io.read(descriptor)
      const graph = this.#graphs.installGraph(descriptor, snapshot)
      this.#state.source(descriptor, { state: 'ready', error: null })
      return graph.data

    }

    catch (error) {
      this.#state.source(descriptor, {
        state: sourceFailureState(error),
        error
      })
      throw error
    }
  }

  graph(sourceOrResource) {
    let source
    if (this.#sources.isResource(sourceOrResource)) {
      const resource = this.#sources.resolveResource(sourceOrResource)
      source = resource.local ?? resource.remote
    }
    else {
      source = this.#sources.resolveSource(sourceOrResource)
    }
    return this.#graphs.graph(source)
  }

  sourceSubjects(sources = this.sources) {
    return this.#graphs.subjects(this.#sources.sourceIds(sources))
  }

  recordFor(object) {
    return this.#graphs.recordFor(object)
  }

  sourceOf(...args) {
    return oldm.one(this.sourcesOf(...args), 'first') ?? null
  }

  sourcesOf(...args) {
    return this.#graphs.sourcesOf(...args)
  }

  createIn(source, object, options = {}) {
    return this.#writes.createIn(source, object, options)
  }

  save(object, options = {}) {
    return this.#writes.save(object, options)
  }

  delete(object, options = {}) {
    return this.#writes.delete(object, options)
  }

  saveAll(objects = this.sourceSubjects()) {
    return this.#writes.saveAll(objects)
  }

  sync(resourceOrId, options = {}) {
    return this.#replicas.sync(this.#sources.resolveResource(resourceOrId), options)
  }
}

function isOpenAllOptions(options) {
  return Boolean(
    isObject(options)
    && !Array.isArray(options)
    && !options.sources
    && !options.resources
    && !options.workspacePart
  )
}
