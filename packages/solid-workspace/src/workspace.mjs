import oldm from '@muze-nl/oldm'
import { from } from '@muze-nl/jaqt'
import * as assert from '@muze-nl/assert'
import { oneOf } from '@muze-nl/assert'
import { WorkspaceCollection } from './collection.mjs'
import {
  cloneValue,
  graphDocumentFrom,
  isObject,
  mergeGraphDocuments
} from './graph-document.mjs'
import {
  errorStatus,
  resourceState,
  sourceFailureState,
  sourceStatus,
  statusFor,
  updateRecordStatus,
  workspaceState
} from './status.mjs'

export function workspace(options = {}) {
  return new SolidWorkspace(options)
}

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

export class SolidWorkspace {
  constructor(options = {}) {
    assert.check(options, Object, 'solid-workspace: workspace options must be an object', TypeError)

    const client = options.solid ?? options.solidApi ?? options.client

    this.solid = client
    this.sources = []
    this.sourceById = new Map()
    this.resources = []
    this.resourceById = new Map()
    this.sourcePatterns = new Map()
    this.status = {
      state: 'idle',
      error: null,
      sources: {},
      resources: {}
    }
    this.records = []
    this.objects = new WeakMap()
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
    const sources = normalizeSources(Array.isArray(sourceOrSources) ? sourceOrSources : [sourceOrSources])

    for (const descriptor of sources) {
      const existing = this.sources.findIndex(source => source.id === descriptor.id)
      if (existing >= 0) {
        this.sources[existing] = descriptor
      } else {
        this.sources.push(descriptor)
      }
      this.sourceById.set(descriptor.id, descriptor)
      this.sourcePatterns.set(descriptor.id, descriptor.id)
      this.setSourceStatus(descriptor, this.status.sources[descriptor.id] ?? { state: 'idle' })
      for (const record of this.records) {
        const source = record.source?.parent ?? record.source
        if (source?.id === descriptor.id) {
          record.source = descriptor
          record.sourceId = recordSourceId(record)
        }
      }
    }

    return sources.length === 1 ? sources[0] : sources
  }

  addResource(part) {
    if (part?.workspacePart !== 'resource') {
      throw new TypeError('solid-workspace: addResource() expects a resource() workspace part')
    }

    const existing = this.resourceById.get(part.id)
    let current = {
      id: part.id,
      type: part.type ?? 'replicated-resource',
      local: null,
      remote: null
    }
    if (existing) {
      current = { ...existing }
    }

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
    } else if (current.local && remoteSource) {
      localSource = resourceReplicaSource(current.local, {
        resource: current,
        replica: 'local',
        syncTo: remoteSource.id
      })
    }

    if (localSource) {
      current.local = this.addSource(localSource)
    }
    if (remoteSource) {
      current.remote = this.addSource(remoteSource)
    }

    const index = this.resources.findIndex(item => item.id === current.id)
    if (index >= 0) {
      this.resources[index] = current
    } else {
      this.resources.push(current)
    }
    this.resourceById.set(current.id, current)
    this.sourcePatterns.set(current.id, (current.local ?? current.remote).id)
    this.setResourceStatus(current)

    return current
  }

  setClient(client) {
    this.solid = client
    return this
  }

  async open(options = {}) {
    if (isResourceReference(this, options)) {
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

    if (Array.isArray(options) && options.some(item => isResourceReference(this, item))) {
      for (const item of options) {
        if (isResourceReference(this, item)) {
          await this.openResource(item)
        } else {
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
    const logicalResource = resolveResource(this, resourceOrId)
    const sources = resourceSources(logicalResource)
    const failures = []
    const loaded = []
    const throwOnError = options.throwOnError ?? false

    this.status.state = 'opening'
    this.status.error = null
    this.setResourceStatus(logicalResource, { state: 'opening', error: null })

    for (const source of sources) {
      try {
        loaded.push({
          source,
          objects: await this.loadSource(source)
        })
      } catch (error) {
        failures.push({ source, error })
        if (throwOnError) {
          this.status.state = 'error'
          this.status.error = error
          this.setResourceStatus(logicalResource, { state: 'error', error })
          throw error
        }
      }
    }

    if (
      logicalResource.local
      && logicalResource.remote
      && this.status.sources[logicalResource.remote.id]?.state === 'ready'
    ) {
      try {
        const document = mergeGraphDocuments([
          this.dataset({ sources: [logicalResource.local.id] }),
          this.dataset({ sources: [logicalResource.remote.id] })
        ], options)

        if (document.changed || options.force === true) {
          await saveGraphDocument(this, logicalResource.local, document, options.writeOptions)
          this.replaceSourceRecords(logicalResource.local, cloneValue(document.data), {
            source: logicalResource.local,
            sourceUrl: logicalResource.local.url,
            status: 'loaded'
          })
          this.setSourceStatus(logicalResource.local, { state: 'ready', error: null })
        }
      } catch (error) {
        failures.push({ source: logicalResource.local, error })
        this.setSourceStatus(logicalResource.local, {
          state: sourceFailureState(error),
          error
        })
        if (throwOnError) {
          this.status.state = 'error'
          this.status.error = error
          this.setResourceStatus(logicalResource, { state: 'error', error })
          throw error
        }
      }
    }

    this.status.lastOpen = { resource: logicalResource, sources, loaded, failures }
    this.status.state = workspaceState(this)
    this.status.error = failures[0]?.error ?? null
    this.setResourceStatus(logicalResource, {
      state: resourceState(this, logicalResource),
      error: failures[0]?.error ?? null
    })
    return this
  }

  async load(options = {}) {
    const sources = normalizeLoadSources(this, options.sources ?? this.sources)
    const failures = []
    const loaded = []
    const throwOnError = options.throwOnError ?? true

    this.status.state = 'opening'
    this.status.error = null

    for (const source of sources) {
      try {
        loaded.push(await this.loadSource(source))
      } catch (error) {
        failures.push({ source, error })
        if (throwOnError) {
          this.status.state = 'error'
          this.status.error = error
          throw error
        }
      }
    }

    this.status.lastOpen = { sources, loaded, failures }
    this.status.state = workspaceState(this)
    this.status.error = failures[0]?.error ?? null
    return this
  }

  async loadSource(sourceOrId) {
    const descriptor = resolveSource(this, sourceOrId)
    this.setSourceStatus(descriptor, { state: 'opening', error: null })

    try {
      if (descriptor.kind === 'container') {
        assertSolidClient(this)
        const entries = await this.solid.contains(descriptor.url, descriptor.options)
        this.replaceSourceRecords(descriptor, [], {
          source: descriptor,
          sourceUrl: descriptor.url,
          status: 'loaded'
        })

        for (const entry of entries) {
          await this.loadSource({
            ...descriptor,
            append: true,
            kind: 'resource',
            url: entry.url,
            parent: descriptor
          })
        }

        this.setSourceStatus(descriptor, { state: 'ready', error: null })
        return entries
      }

      if (typeof descriptor.load === 'function') {
        const document = graphDocumentFrom(await descriptor.load({
          source: descriptor,
          workspace: this
        }))
        const objects = document.data

        if (descriptor.append) {
          this.trackObjects(objects, {
            source: descriptor,
            sourceUrl: descriptor.url,
            status: 'loaded'
          })
        } else {
          this.replaceSourceRecords(descriptor, objects, {
            source: descriptor,
            sourceUrl: descriptor.url,
            status: 'loaded'
          })
        }
        this.setSourceStatus(descriptor, { state: 'ready', error: null })

        return objects
      }

      assertSolidClient(this)
      try {
        const data = await this.solid.get(descriptor.url, requestOptions(descriptor.options))
        const objects = Object.values(data.subjects)

        if (descriptor.append) {
          this.trackObjects(objects, {
            data,
            source: descriptor,
            sourceUrl: descriptor.url,
            status: 'loaded'
          })
        } else {
          this.replaceSourceRecords(descriptor, objects, {
            data,
            source: descriptor,
            sourceUrl: descriptor.url,
            status: 'loaded'
          })
        }
        this.setSourceStatus(descriptor, { state: 'ready', error: null })

        return objects
      } catch (error) {
        if ([404, 410].includes(errorStatus(error))) {
          if (!descriptor.append) {
            this.replaceSourceRecords(descriptor, [], {
              source: descriptor,
              sourceUrl: descriptor.url,
              status: 'loaded'
            })
          }
          this.setSourceStatus(descriptor, { state: 'ready', error: null })
          return []
        }
        throw error
      }
    } catch (error) {
      this.setSourceStatus(descriptor, {
        state: sourceFailureState(error),
        error
      })
      throw error
    }
  }

  trackObjects(objects, options = {}) {
    for (const object of objects) {
      this.track(object, options)
    }

    return objects
  }

  replaceSourceRecords(source, objects, options = {}) {
    this.records = this.records.filter(record => (
      record.status === 'new'
      || !recordBelongsToSources(record, [source])
    ))
    this.objects = new WeakMap()

    for (const record of this.records) {
      this.objects.set(record.object, record)
    }

    return this.trackObjects(objects, options)
  }

  dataset(options = {}) {
    const config = normalizeDatasetOptions(this, options)
    const records = recordsForSources(this, config.sources ?? this.sources)
    return mergeGraphDocuments(records
      .filter(record => record.object.id)
      .map(record => ({
        format: config.format,
        version: config.version,
        prefixes: config.prefixes,
        subjects: {
          [record.object.id]: record.object
        }
      })), config)
  }

  async sync(options = {}) {
    if (isResourceReference(this, options)) {
      return this.syncResource(options)
    }

    const target = resolveSource(this, options.into)

    if (target.kind !== 'resource') {
      throw new Error('solid-workspace: sync target must be a resource source')
    }

    if (target.readOnly) {
      throw new Error(`solid-workspace: source ${target.id} is read-only`)
    }

    let sourceDocument = options.document
    if (sourceDocument == null) {
      sourceDocument = this.dataset({
        sources: options.from ?? this.sources,
        format: options.format,
        version: options.version,
        prefixes: options.prefixes
      })
    }
    let targetDocument
    if (options.loadTarget === false) {
      targetDocument = graphDocumentFrom(options.targetDocument)
    } else {
      targetDocument = await this.loadGraphDocument(target, options)
    }
    const document = mergeGraphDocuments([
      targetDocument,
      sourceDocument
    ], options)

    if (!document.changed && options.force !== true) {
      this.clearSyncPending(target)
      return {
        ok: true,
        status: 'unchanged',
        source: target,
        sourceUrl: target.url,
        document
      }
    }

    try {
      this.setSourceStatus(target, { state: 'syncing', error: null })
      const response = await saveGraphDocument(this, target, document, options.writeOptions)
      this.clearSyncPending(target)
      this.setSourceStatus(target, { state: 'ready', error: null })

      return {
        ok: true,
        status: 'synced',
        source: target,
        sourceUrl: target.url,
        document,
        response
      }
    } catch (error) {
      this.setSourceStatus(target, {
        state: sourceFailureState(error),
        error
      })
      throw error
    }
  }

  async syncResource(resourceOrId, options = {}) {
    const logicalResource = resolveResource(this, resourceOrId)
    const localSource = logicalResource.local
    const remoteSource = logicalResource.remote

    if (!localSource) {
      throw new Error(`solid-workspace: resource ${logicalResource.id} needs a local replica to sync`)
    }
    if (!remoteSource) {
      throw new Error(`solid-workspace: resource ${logicalResource.id} needs a remote replica to sync`)
    }
    if (remoteSource.readOnly) {
      throw new Error(`solid-workspace: source ${remoteSource.id} is read-only`)
    }

    this.setResourceStatus(logicalResource, { state: 'syncing', error: null })
    this.setSourceStatus(remoteSource, { state: 'syncing', error: null })

    let remoteDocument
    try {
      if (options.loadRemote === false) {
        remoteDocument = graphDocumentFrom(options.remoteDocument)
      } else {
        remoteDocument = await this.loadGraphDocument(remoteSource, options)
      }
    } catch (error) {
      this.setSourceStatus(remoteSource, {
        state: sourceFailureState(error),
        error
      })
      this.markSyncPending({
        from: localSource.id,
        into: remoteSource.id
      })
      this.setResourceStatus(logicalResource, {
        state: 'sync-pending',
        error
      })
      return {
        ok: false,
        status: this.status.sources[remoteSource.id].state,
        resource: logicalResource,
        source: remoteSource,
        sourceUrl: remoteSource.url,
        error
      }
    }

    const localDocument = this.dataset({
      sources: [localSource.id],
      format: options.format,
      version: options.version,
      prefixes: options.prefixes
    })
    const document = mergeGraphDocuments([
      remoteDocument,
      localDocument
    ], options)

    if (!document.changed && options.force !== true) {
      this.clearSyncPending(remoteSource)
      this.setResourceStatus(logicalResource, { state: 'ready', error: null })
      return {
        ok: true,
        status: 'unchanged',
        resource: logicalResource,
        source: remoteSource,
        sourceUrl: remoteSource.url,
        document
      }
    }

    let response
    try {
      response = await saveGraphDocument(this, remoteSource, document, options.writeOptions)
    } catch (error) {
      this.setSourceStatus(remoteSource, {
        state: sourceFailureState(error),
        error
      })
      this.markSyncPending({
        from: localSource.id,
        into: remoteSource.id
      })
      this.setResourceStatus(logicalResource, {
        state: 'sync-pending',
        error
      })
      return {
        ok: false,
        status: this.status.sources[remoteSource.id].state,
        resource: logicalResource,
        source: remoteSource,
        sourceUrl: remoteSource.url,
        error
      }
    }

    try {
      await saveGraphDocument(this, localSource, document, options.localWriteOptions ?? options.writeOptions)
      this.replaceSourceRecords(remoteSource, cloneValue(document.data), {
        source: remoteSource,
        sourceUrl: remoteSource.url,
        status: 'loaded'
      })
      this.replaceSourceRecords(localSource, cloneValue(document.data), {
        source: localSource,
        sourceUrl: localSource.url,
        status: 'loaded'
      })
      this.clearSyncPending(remoteSource)
      this.setSourceStatus(remoteSource, { state: 'ready', error: null })
      this.setSourceStatus(localSource, { state: 'ready', error: null })
      this.setResourceStatus(logicalResource, { state: 'ready', error: null })

      return {
        ok: true,
        status: 'synced',
        resource: logicalResource,
        source: remoteSource,
        sourceUrl: remoteSource.url,
        document,
        response
      }
    } catch (error) {
      this.setSourceStatus(localSource, {
        state: sourceFailureState(error),
        error
      })
      this.setResourceStatus(logicalResource, {
        state: 'error',
        error
      })
      return {
        ok: false,
        status: this.status.sources[localSource.id].state,
        resource: logicalResource,
        source: localSource,
        sourceUrl: localSource.url,
        error
      }
    }
  }

  async loadGraphDocument(sourceOrId, options = {}) {
    const descriptor = resolveSource(this, sourceOrId)

    if (descriptor.kind !== 'resource') {
      throw new Error('solid-workspace: graph documents can only be loaded from resource sources')
    }

    if (typeof descriptor.load === 'function') {
      return graphDocumentFrom(await descriptor.load({
        source: descriptor,
        workspace: this,
        ...options.readOptions
      }))
    }

    assertSolidClient(this)
    try {
      const response = await this.solid.get(descriptor.url, requestOptions({
        ...descriptor.options,
        ...options.readOptions
      }))

      return graphDocumentFrom(response)
    } catch (error) {
      const status = errorStatus(error)
      if (status === 404 || status === 410) {
        return graphDocumentFrom(null)
      }
      throw error
    }
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

    this.records.push(record)
    this.objects.set(object, record)
    return record
  }

  sourceOf(object, predicate, value) {
    return oldm.one(this.sourcesOf(object, predicate, value), 'first') ?? null
  }

  sourcesOf(object, predicate, value) {
    const record = this.objects.get(object)
    if (!record) {
      return []
    }

    const oldmSources = oldmSourcesOf(record, object, predicate, value)
    if (oldmSources.length > 0) {
      return oldmSources.map(sourceUrl => ({
        sourceUrl,
        source: this.sourceById.get(sourceUrl) ?? record.source,
        record
      }))
    }

    return [{
      sourceUrl: record.sourceUrl,
      source: record.source,
      record
    }]
  }

  async createIn(sourceOrId, object, options = {}) {
    const descriptor = resolveCreateSource(this, sourceOrId)

    if (descriptor.readOnly) {
      throw new Error(`solid-workspace: source ${descriptor.id} is read-only`)
    }

    this.track(object, {
      source: descriptor,
      sourceUrl: null,
      status: 'new',
      created: true
    })

    if (options.save === false) {
      return object
    }

    await this.save(object, options)
    return object
  }

  async save(object, options = {}) {
    const record = this.objects.get(object)

    if (!record) {
      throw new Error('solid-workspace: cannot save an object that is not tracked by this workspace')
    }

    const issues = validateRecord(record)
    if (issues) {
      return updateRecordStatus(record, {
        ok: false,
        status: 'validation_failed',
        issues
      })
    }

    if (record.readOnly) {
      return updateRecordStatus(record, {
        ok: false,
        status: 'read_only',
        error: new Error(`solid-workspace: source ${record.source?.id ?? record.sourceUrl} is read-only`)
      })
    }

    try {
      if (typeof record.source?.save === 'function') {
        const document = this.dataset({
          sources: [record.source.id]
        })
        const response = await saveGraphDocument(this, record.source, document, options)
        record.sourceUrl = record.source.url
        record.created = false
        this.setSourceStatus(record.source, { state: 'ready', error: null })
        const syncTo = options.syncTo ?? record.source.syncTo
        if (syncTo) {
          this.markSyncPending({
            from: record.source.id,
            into: syncTo
          })
        }
        return updateRecordStatus(record, {
          ok: true,
          status: record.deleted ? 'deleted' : 'saved',
          response
        })
      }

      assertSolidClient(this)
      if (record.deleted) {
        const response = await this.solid.delete(record.sourceUrl, requestOptions(options))
        this.setSourceStatus(record.source, { state: 'ready', error: null })
        return updateRecordStatus(record, { ok: true, status: 'deleted', response })
      }

      if (record.created || !record.sourceUrl) {
        const source = record.source
        let response
        if (source.kind === 'container') {
          response = await this.solid.postToContainer(source.url, record.object, writeOptions(source, options))
        } else {
          response = await this.solid.create(source.url, record.object, writeOptions(source, options))
        }

        record.sourceUrl = response.location ?? source.url
        record.created = false
        this.setSourceStatus(record.source, { state: 'ready', error: null })
        return updateRecordStatus(record, { ok: true, status: 'created', response })
      }

      const response = await this.solid.put(record.sourceUrl, bodyOptions(record.object, writeOptions(record.source, options)))
      this.setSourceStatus(record.source, { state: 'ready', error: null })
      return updateRecordStatus(record, { ok: true, status: 'saved', response })
    } catch (error) {
      this.setSourceStatus(record.source, {
        state: sourceFailureState(error),
        error
      })
      return updateRecordStatus(record, { ok: false, status: 'error', error })
    }
  }

  async delete(object, options = {}) {
    const record = this.objects.get(object)

    if (!record) {
      throw new Error('solid-workspace: cannot delete an object that is not tracked by this workspace')
    }

    record.deleted = true
    if (options.save === false) {
      record.status = 'deleted_pending'
      return statusFor(record, { ok: true, status: record.status })
    }

    return this.save(object, options)
  }

  async saveAll(records = this.records) {
    const statuses = []

    for (const recordOrObject of records) {
      const object = recordOrObject?.object ?? recordOrObject
      statuses.push(await this.save(object))
    }

    const failures = statuses.filter(status => !status.ok)

    if (failures.length > 0) {
      const error = new Error('solid-workspace: saveAll failed', {
        cause: {
          failures
        }
      })
      error.statuses = statuses
      throw error
    }

    return statuses
  }

  markSyncPending({ from, into }) {
    const targets = Array.isArray(into) ? into : [into]

    for (const target of targets) {
      const source = resolveSource(this, target)
      const current = this.status.sources[source.id] ?? sourceStatus(source, { state: 'idle' })
      let state = 'sync-pending'
      if (current.state === 'opening' || current.state === 'syncing') {
        state = current.state
      }

      this.setSourceStatus(source, {
        ...current,
        state,
        syncPending: true,
        pendingFrom: unique([
          ...oldm.many(current.pendingFrom),
          ...oldm.many(from)
        ])
      })
    }

    return this
  }

  clearSyncPending(sourceOrId) {
    const source = resolveSource(this, sourceOrId)
    const current = this.status.sources[source.id] ?? sourceStatus(source, { state: 'idle' })
    let state = current.state
    if (current.state === 'sync-pending') {
      state = 'ready'
    }

    this.setSourceStatus(source, {
      ...current,
      state,
      syncPending: false,
      pendingFrom: []
    })
    return this
  }

  setSourceStatus(sourceOrId, status = {}) {
    let source = sourceOrId?.parent ?? sourceOrId
    if (typeof sourceOrId === 'string') {
      source = this.sourceById.get(sourceOrId) ?? { id: sourceOrId }
    }

    if (!source?.id) {
      return null
    }

    const current = this.status?.sources?.[source.id] ?? {}
    const next = sourceStatus(source, {
      ...current,
      ...status
    })
    this.status.sources[source.id] = next
    return next
  }

  setResourceStatus(resourceOrId, status = {}) {
    let logicalResource = resourceOrId
    if (typeof resourceOrId === 'string') {
      logicalResource = this.resourceById.get(resourceOrId) ?? { id: resourceOrId }
    }

    if (!logicalResource?.id) {
      return null
    }

    const current = this.status?.resources?.[logicalResource.id] ?? {}
    const next = {
      id: logicalResource.id,
      type: logicalResource.type ?? 'replicated-resource',
      local: logicalResource.local?.id ?? null,
      remote: logicalResource.remote?.id ?? null,
      state: status.state ?? current.state ?? 'idle',
      error: status.error ?? current.error ?? null
    }
    this.status.resources[logicalResource.id] = next
    return next
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

function normalizeDatasetOptions(currentWorkspace, options = {}) {
  if (isResourceReference(currentWorkspace, options)) {
    return {
      resources: [options],
      sources: datasetSourcesForResources(currentWorkspace, [options])
    }
  }

  if (options?.resources) {
    const resources = Array.isArray(options.resources) ? options.resources : [options.resources]
    return {
      ...options,
      sources: datasetSourcesForResources(currentWorkspace, resources)
    }
  }

  return options
}

function normalizeLoadSources(currentWorkspace, sources) {
  if (!Array.isArray(sources)) {
    sources = [sources]
  }

  return sources.map(sourceOrId => resolveSource(currentWorkspace, sourceOrId))
}

function isResourceReference(currentWorkspace, value) {
  return Boolean(
    value?.workspacePart === 'resource'
    || (typeof value === 'string' && currentWorkspace.resourceById.has(value))
  )
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

function resolveResource(currentWorkspace, resourceOrId) {
  if (!resourceOrId) {
    throw new TypeError('solid-workspace: resource is required')
  }

  if (typeof resourceOrId === 'string') {
    const logicalResource = currentWorkspace.resourceById.get(resourceOrId)
    if (!logicalResource) {
      throw new Error(`solid-workspace: unknown resource ${resourceOrId}`)
    }
    return logicalResource
  }

  if (resourceOrId.workspacePart === 'resource') {
    return currentWorkspace.resourceById.get(resourceOrId.id) ?? resourceOrId
  }

  return resourceOrId
}

function resourceSources(logicalResource) {
  return [logicalResource.local, logicalResource.remote].filter(Boolean)
}

function datasetSourcesForResources(currentWorkspace, resources) {
  return resources.flatMap(resourceOrId => {
    const logicalResource = resolveResource(currentWorkspace, resourceOrId)
    return [logicalResource.local ?? logicalResource.remote].filter(Boolean)
  })
}

function resolveSource(currentWorkspace, sourceOrId) {
  if (!sourceOrId) {
    throw new TypeError('solid-workspace: source is required')
  }

  if (typeof sourceOrId === 'string') {
    const descriptor = currentWorkspace.sourceById.get(sourceOrId)
    if (!descriptor) {
      throw new Error(`solid-workspace: unknown source ${sourceOrId}`)
    }
    return descriptor
  }

  return sourceOrId
}

function resolveCreateSource(currentWorkspace, sourceOrResourceOrId) {
  if (isResourceReference(currentWorkspace, sourceOrResourceOrId)) {
    const logicalResource = resolveResource(currentWorkspace, sourceOrResourceOrId)
    if (!logicalResource.local) {
      throw new Error(`solid-workspace: resource ${logicalResource.id} needs a local replica for local-first writes`)
    }
    return logicalResource.local
  }

  return resolveSource(currentWorkspace, sourceOrResourceOrId)
}

function recordsForSources(currentWorkspace, sources) {
  const descriptors = new Set(normalizeLoadSources(currentWorkspace, sources))
  const ids = new Set([...descriptors].map(source => source.id))

  return from(currentWorkspace.records)
    .where(record => {
      if (record.deleted) {
        return false
      }

      const source = record.source?.parent ?? record.source
      return source && (descriptors.has(source) || ids.has(source.id))
    })
    .toArray()
}

function recordBelongsToSources(record, sources) {
  const source = record.source?.parent ?? record.source
  return Boolean(source && sources.some(candidate => candidate === source || candidate.id === source.id))
}

function recordSourceId(record) {
  return record.source?.parent?.id ?? record.source?.id ?? null
}

async function saveGraphDocument(workspace, source, document, options = {}) {
  if (typeof source.save === 'function') {
    return source.save(document, {
      source,
      workspace,
      ...options
    })
  }

  assertSolidClient(workspace)
  return workspace.solid.put(source.url, bodyOptions(document, writeOptions(source, options)))
}

function assertSolidClient(workspace) {
  if (!workspace.solid) {
    throw new TypeError('solid-workspace: a Solid API client is required for Solid sources')
  }
}

function oldmSourcesOf(record, object, predicate, value) {
  const data = record.data
  const context = data?.context ?? data?.primary?.context

  if (!context || typeof context.sources !== 'function') {
    return []
  }

  return context.sources(object, predicate, value)
    .map(source => typeof source === 'string' ? source : source?.url ?? source?.id)
    .filter(Boolean)
}

function validateRecord(record) {
  if (record.source.shape) {
    return record.source.shape.fails(record.object)
  }
  return false
}

function writeOptions(source, options) {
  const headers = new Headers(source?.writeOptions?.headers)
  for (const [key, value] of new Headers(options?.headers)) {
    headers.set(key, value)
  }
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'text/turtle')
  }

  return {
    ...source?.writeOptions,
    ...options,
    headers
  }
}

function requestOptions(options = {}) {
  return {
    ...options,
    headers: new Headers(options.headers)
  }
}

function bodyOptions(body, options = {}) {
  return {
    ...options,
    body,
    headers: new Headers(options.headers)
  }
}

function ensureSlash(url) {
  return String(url).endsWith('/') ? String(url) : `${url}/`
}

function unique(items) {
  return [...new Set(items)]
}
