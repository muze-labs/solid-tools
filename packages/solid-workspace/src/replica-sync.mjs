import { mergeReplicas } from './replicas.mjs'
import { resourceSources } from './sources.mjs'
import { resourceState, sourceFailureState, workspaceState } from './status.mjs'

export class ReplicaSync {
  constructor({ graphs, io, state, operations }) {
    this.graphs = graphs
    this.io = io
    this.state = state
    this.operations = operations
  }

  open(resource, options = {}) {
    return this.operations.sequence(resource.id, () => this.openReplica(resource, options))
  }

  sync(resource, options = {}) {
    return this.operations.sequence(resource.id, () => this.syncReplica(resource, options))
  }

  async openReplica(logicalResource, options) {
    const revision = this.operations.revision(logicalResource.id)
    const sources = resourceSources(logicalResource)
    const loaded = []
    const failures = []
    this.state.value.state = 'opening'
    this.state.value.error = null
    this.state.resource(logicalResource, { state: 'opening', error: null })

    for (const source of sources) {
      this.state.source(source, { state: 'opening', error: null })
      try {
        const snapshot = await this.io.read(source, options)
        loaded.push({ source, snapshot })
        this.state.source(source, { state: 'ready', error: null })
      }
      catch (error) {
        failures.push({ source, error })
        this.state.source(source, { state: sourceFailureState(error), error })
      }
    }

    const isCurrent = () => this.operations.revision(logicalResource.id) === revision
    const local = loaded.find(entry => entry.source === logicalResource.local)
    const remote = loaded.find(entry => entry.source === logicalResource.remote)
    if (isCurrent() && local && remote) {
      try {
        local.snapshot = mergeReplicas([local.snapshot, remote.snapshot], logicalResource)
        await this.io.write(local.source, local.snapshot, options.writeOptions)
      }
      catch (error) {
        failures.push({ source: local.source, error })
        this.state.source(local.source, { state: sourceFailureState(error), error })
      }
    }
    // A save admitted during a read owns the newer working value. Its queued
    // commit follows this open; publishing the read now would undo that edit.
    if (isCurrent()) {
      for (const { source, snapshot } of loaded) {
        if (failures.some(failure => failure.source === source)) {
          continue
        }
        this.graphs.installGraph(source, snapshot)
      }
    }
    this.state.value.lastOpen = { resource: logicalResource, sources, loaded, failures }
    this.state.value.state = workspaceState(this.state.value)
    this.state.value.error = failures[0]?.error ?? null
    this.state.resource(logicalResource, {
      state: failures.some(failure => failure.source === logicalResource.local) ? 'error' : resourceState(this.state.value, logicalResource),
      error: failures[0]?.error ?? null
    })
    if (options.throwOnError && failures.length) {
      throw failures[0].error
    }
  }

  async syncReplica(logicalResource, options = {}) {
    const localSource = logicalResource.local
    const remoteSource = logicalResource.remote
    if (!localSource || !remoteSource) {
      throw new Error(`solid-workspace: resource ${logicalResource.id} needs local and remote replicas to sync`)
    }
    if (remoteSource.readOnly) {
      throw new Error(`solid-workspace: source ${remoteSource.id} is read-only`)
    }

    const revision = this.operations.revision(logicalResource.id)
    const isCurrent = () => this.operations.revision(logicalResource.id) === revision
    this.state.resource(logicalResource, { state: 'syncing', error: null })
    this.state.source(remoteSource, { state: 'syncing', error: null })
    let activeSource = remoteSource
    let snapshot
    let localSaved = false
    try {
      const remoteGraph = await this.io.read(remoteSource, options)
      if (!isCurrent()) {
        return this.pendingReplica(logicalResource)
      }
      snapshot = mergeReplicas([
        remoteGraph,
        this.graphs.graph(localSource)
      ], logicalResource)

      activeSource = localSource
      await this.io.write(localSource, snapshot, options.localWriteOptions ?? options.writeOptions)
      localSaved = true
      this.state.source(localSource, { state: 'ready', error: null })
      if (!isCurrent()) {
        return this.pendingReplica(logicalResource)
      }

      activeSource = remoteSource
      const response = await this.io.write(remoteSource, snapshot, options.writeOptions)
      if (!isCurrent()) {
        return this.pendingReplica(logicalResource)
      }
      this.publishReplica(localSource, snapshot)
      this.publishReplica(remoteSource, snapshot)
      this.state.clearPending(remoteSource)
      this.state.resource(logicalResource, { state: 'ready', error: null })
      return { ok: true, status: 'synced', resource: logicalResource, source: remoteSource, sourceUrl: remoteSource.url, graph: snapshot, response }
    }
    catch (error) {
      // A failed remote write still leaves the merged local resource usable.
      if (localSaved && isCurrent()) {
        this.publishReplica(localSource, snapshot)
      }
      this.pendingReplica(logicalResource)
      this.state.source(activeSource, { state: sourceFailureState(error), error })
      this.state.resource(logicalResource, {
        state: activeSource === localSource ? 'error' : 'sync-pending', error
      })
      return { ok: false, status: this.state.value.sources[activeSource.id].state, resource: logicalResource, source: activeSource, sourceUrl: activeSource.url, localSaved, error }
    }
  }

  publishReplica(source, snapshot) {
    this.graphs.installGraph(source, snapshot)
    this.state.source(source, { state: 'ready', error: null })
  }

  pendingReplica(logicalResource) {
    this.state.pending(logicalResource.local.id, [logicalResource.remote])
    this.state.source(logicalResource.remote, { state: 'sync-pending' })
    this.state.resource(logicalResource, { state: 'sync-pending', error: null })
    return { ok: true, status: 'sync-pending', resource: logicalResource }
  }
}
