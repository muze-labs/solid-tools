import * as assert from '@muze-nl/assert'
import { oneOf } from '@muze-nl/assert'

export function resource(idOrOptions, options = {}) {
  let config = { ...idOrOptions }
  if (typeof idOrOptions === 'string') {
    config = { ...options, id: idOrOptions }
  }

  if (!config.id) {
    throw new TypeError('solid-workspace: resource id is required')
  }

  if (!config.local && !config.remote) {
    throw new TypeError('solid-workspace: resource() needs a local or remote replica')
  }

  if (config.local) {
    assertWorkspaceSource(config.local, 'local')
  }
  if (config.remote) {
    assertWorkspaceSource(config.remote, 'remote')
  }

  return Object.freeze({
    ...config,
    workspacePart: 'resource',
    type: config.type ?? 'replicated-resource',
    id: String(config.id)
  })
}

export const solid = {
  resource(url, options = {}) {
    return source('resource', url, {
      type: 'solid-resource',
      ...options
    })
  },
  container(url, options = {}) {
    return source('container', ensureSlash(url), {
      type: 'solid-container',
      ...options
    })
  },
  client(client, options = {}) {
    if (!client) {
      throw new TypeError('solid-workspace: solid client is required')
    }

    return Object.freeze({
      ...options,
      workspacePart: 'client',
      type: options.type ?? 'solid-api-client',
      client
    })
  }
}

export const graph = {
  resource(options = {}) {
    return graphResource(options)
  }
}

// Owns configured sources, replica associations and reference resolution.
// Registration does not load graphs or change persistence status.
export class WorkspaceSources {
  #sourceById
  #resourceById
  #sourcePatterns

  constructor() {
    this.sources = []
    this.resources = []
    this.#sourceById = new Map()
    this.#resourceById = new Map()
    this.#sourcePatterns = new Map()
  }

  add(sourceOrSources) {
    const selected = Array.isArray(sourceOrSources)
      ? sourceOrSources : [sourceOrSources]
    // Validate the complete batch before changing the registry.
    const sources = normalizeSources(selected)
    for (const source of sources) {
      const index = this.sources.findIndex(item => item.id === source.id)
      if (index >= 0) {
        this.sources[index] = source
      }
      else {
        this.sources.push(source)
      }
      this.#sourceById.set(source.id, source)
      this.#sourcePatterns.set(source.id, source.id)
    }
    return sources
  }

  addResource(part) {
    if (part?.workspacePart !== 'resource') {
      throw new TypeError('solid-workspace: addResource() expects a resource() workspace part')
    }

    const existing = this.#resourceById.get(part.id)
    let current = {
      id: part.id,
      type: part.type ?? 'replicated-resource',
      local: null,
      remote: null
    }
    if (existing) {
      current = { ...existing }
    }

    current.scalarPredicates = part.scalarPredicates ?? current.scalarPredicates ?? []

    let remoteSource = current.remote
    if (part.remote) {
      remoteSource = resourceReplicaSource(part.remote, {
        resource: current,
        replica: 'remote'
      })
    }

    let localSource = current.local
    if (part.local) {
      localSource = resourceReplicaSource(part.local, {
        resource: current,
        replica: 'local',
        syncTo: remoteSource?.id
      })
    }
    else if (current.local && remoteSource) {
      localSource = resourceReplicaSource(current.local, {
        resource: current,
        replica: 'local',
        syncTo: remoteSource.id
      })
    }

    if (localSource) {
      current.local = this.add(localSource)[0]
    }
    if (remoteSource) {
      current.remote = this.add(remoteSource)[0]
    }

    const index = this.resources.findIndex(item => item.id === current.id)
    if (index >= 0) {
      this.resources[index] = current
    }
    else {
      this.resources.push(current)
    }
    this.#resourceById.set(current.id, current)
    this.#sourcePatterns.set(current.id, (current.local ?? current.remote).id)

    return current
  }

  isResource(value) {
    return Boolean(value?.workspacePart === 'resource'
      || (typeof value === 'string' && this.#resourceById.has(value)))
  }

  sourceIds(sources) {
    return new Set(sources.map(source => (
      this.#sourcePatterns.get(source?.id ?? source) ?? source?.id ?? source
    )))
  }

  resolveSources(sources = this.sources) {
    const selected = Array.isArray(sources) ? sources : [sources]
    return selected.map(source => this.resolveSource(source))
  }

  resolveSource(sourceOrId) {
    if (!sourceOrId) {
      throw new TypeError('solid-workspace: source is required')
    }

    if (typeof sourceOrId === 'string') {
      const descriptor = this.#sourceById.get(sourceOrId)
      if (!descriptor) {
        throw new Error(`solid-workspace: unknown source ${sourceOrId}`)
      }
      return descriptor
    }

    return sourceOrId
  }

  resolveResource(resourceOrId) {
    if (!resourceOrId) {
      throw new TypeError('solid-workspace: resource is required')
    }

    if (typeof resourceOrId === 'string') {
      const logicalResource = this.#resourceById.get(resourceOrId)
      if (!logicalResource) {
        throw new Error(`solid-workspace: unknown resource ${resourceOrId}`)
      }
      return logicalResource
    }

    if (resourceOrId.workspacePart === 'resource') {
      return this.#resourceById.get(resourceOrId.id) ?? resourceOrId
    }

    return resourceOrId
  }

  resolveCreateSource(sourceOrResourceOrId) {
    if (this.isResource(sourceOrResourceOrId)) {
      const logicalResource = this.resolveResource(sourceOrResourceOrId)
      if (!logicalResource.local) {
        throw new Error(`solid-workspace: resource ${logicalResource.id} needs a local replica for local-first writes`)
      }
      return logicalResource.local
    }

    return this.resolveSource(sourceOrResourceOrId)
  }
}

export function graphResource(options = {}) {
  assert.check(options, Object, 'solid-workspace: graph resource options must be an object', TypeError)
  if (!options.id) {
    throw new TypeError('solid-workspace: graph resource id is required')
  }
  if (!options.url) {
    throw new TypeError('solid-workspace: graph resource url is required')
  }
  if (typeof options.load !== 'function') {
    throw new TypeError('solid-workspace: graph resource load() is required')
  }

  return Object.freeze({
    ...options,
    workspacePart: 'source',
    kind: 'resource',
    type: options.type ?? 'graph-resource',
    readOnly: Boolean(options.readOnly),
    shape: options.shape ?? null,
    options: options.options ?? {},
    writeOptions: options.writeOptions,
    id: options.id,
    url: String(options.url)
  })
}

function source(kind, url, options) {
  if (!url) {
    throw new TypeError('solid-workspace: source url is required')
  }

  return Object.freeze({
    ...options,
    workspacePart: 'source',
    kind,
    type: options.type ?? kind,
    id: options.id ?? String(url),
    url: String(url),
    readOnly: Boolean(options.readOnly),
    shape: options.shape ?? null,
    options: options.options ?? {}
  })
}

function assertWorkspaceSource(descriptor, role = 'source') {
  if (descriptor?.workspacePart !== 'source') {
    throw new TypeError(`solid-workspace: resource ${role} replica must be a source from a factory`)
  }
}

function resourceReplicaSource(descriptor, { resource, replica, syncTo } = {}) {
  assertWorkspaceSource(descriptor, replica)

  return Object.freeze({
    ...descriptor,
    logicalResource: resource.id,
    replica,
    syncTo: syncTo ?? descriptor.syncTo
  })
}

function normalizeSources(sources) {
  assert.check(sources, Array, 'solid-workspace: sources must be an array', TypeError)

  return sources.map(descriptor => {
    assert.check(descriptor, {
      kind: oneOf('resource', 'container')
    }, 'solid-workspace: sources must be solid.resource() or solid.container() descriptors', TypeError)

    return descriptor
  })
}

function ensureSlash(url) {
  return String(url).endsWith('/') ? String(url) : `${url}/`
}

export function resourceSources(logicalResource) {
  return [logicalResource.local, logicalResource.remote].filter(Boolean)
}

export function recordSourceId(record) {
  return record.source?.parent?.id ?? record.source?.id ?? null
}
