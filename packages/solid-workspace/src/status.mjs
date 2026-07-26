import oldm from '@muze-nl/oldm'

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

export function workspaceState(currentWorkspace) {
  const states = Object.values(currentWorkspace.status.sources).map(status => status.state)

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

export function resourceState(currentWorkspace, logicalResource) {
  const states = resourceSources(logicalResource)
    .map(source => currentWorkspace.status.sources[source.id]?.state)
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

function resourceSources(logicalResource) {
  return [logicalResource.local, logicalResource.remote].filter(Boolean)
}
