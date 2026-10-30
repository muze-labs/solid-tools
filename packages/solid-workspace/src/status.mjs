import oldm from '@muze-nl/oldm'
import { resourceSources } from './sources.mjs'

export function updateRecordStatus(record, status) {
  record.status = status.status
  record.error = status.error ?? null
  record.response = status.response ?? record.response
  return statusFor(record, status)
}

export function statusFor(record, status = {}) {
  return {
    object: record.object,
    sourceUrl: record.sourceUrl,
    source: record.source,
    ...status
  }
}

export function sourceStatus(source, status = {}) {
  return {
    id: source.id,
    type: source.type ?? source.kind ?? 'source',
    url: source.url ?? null,
    local: Boolean(source.local),
    logicalResource: source.logicalResource ?? null,
    replica: source.replica ?? null,
    state: status.state ?? 'idle',
    error: status.error ?? null,
    syncPending: Boolean(status.syncPending),
    pendingFrom: oldm.many(status.pendingFrom)
  }
}

export function workspaceState(status) {
  const states = Object.values(status.sources).map(status => status.state)

  if (states.length === 0) {
    return 'idle'
  }

  if (states.some(state => state === 'ready' || state === 'sync-pending')) {
    return 'ready'
  }

  if (states.some(state => state === 'opening' || state === 'syncing')) {
    return 'opening'
  }

  return 'error'
}

export function resourceState(status, logicalResource) {
  const states = resourceSources(logicalResource)
    .map(source => status.sources[source.id]?.state)
    .filter(Boolean)

  if (states.length === 0) {
    return 'idle'
  }

  if (states.some(state => state === 'sync-pending')) {
    return 'sync-pending'
  }

  if (states.some(state => state === 'ready')) {
    return 'ready'
  }

  if (states.some(state => state === 'opening' || state === 'syncing')) {
    return 'opening'
  }

  return states[0] ?? 'idle'
}

export function sourceFailureState(error) {
  const status = errorStatus(error)

  if (status === 401 || status === 403) {
    return 'auth-needed'
  }

  if (!status || error?.name === 'TypeError') {
    return 'offline'
  }

  return 'error'
}

export function errorStatus(error) {
  return error?.cause?.status
}

export class WorkspaceStatus {
  constructor() {
    this.value = { state: 'idle', error: null, sources: {}, resources: {} }
  }

  source(descriptor, status = {}) {
    const source = descriptor?.parent ?? descriptor

    if (!source?.id) {
      return null
    }

    const current = this.value?.sources?.[source.id] ?? {}
    const next = sourceStatus(source, {
      ...current,
      ...status
    })
    this.value.sources[source.id] = next
    return next
  }

  resource(logicalResource, status = {}) {
    if (!logicalResource?.id) {
      return null
    }

    const current = this.value?.resources?.[logicalResource.id] ?? {}
    const next = {
      id: logicalResource.id,
      type: logicalResource.type ?? 'replicated-resource',
      local: logicalResource.local?.id ?? null,
      remote: logicalResource.remote?.id ?? null,
      state: status.state ?? current.state ?? 'idle',
      error: Object.hasOwn(status, 'error') ? status.error : current.error ?? null
    }
    this.value.resources[logicalResource.id] = next
    return next
  }

  pending(from, targets) {
    for (const source of targets) {
      const current = this.value.sources[source.id] ?? sourceStatus(source, { state: 'idle' })
      let state = 'sync-pending'
      if (current.state === 'opening' || current.state === 'syncing') {
        state = current.state
      }

      this.source(source, {
        ...current,
        state,
        syncPending: true,
        pendingFrom: [...new Set([
          ...oldm.many(current.pendingFrom),
          ...oldm.many(from)
        ])]
      })
    }

    return this
  }

  clearPending(source) {
    const current = this.value.sources[source.id] ?? sourceStatus(source, { state: 'idle' })
    let state = current.state
    if (current.state === 'sync-pending') {
      state = 'ready'
    }

    this.source(source, {
      ...current,
      state,
      syncPending: false,
      pendingFrom: []
    })
    return this
  }
}
