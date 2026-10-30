import { isDeleted, markDeleted } from './replicas.mjs'
import { sourceFailureState, statusFor, updateRecordStatus } from './status.mjs'

// Admission, validation, save/delete outcomes and rollback for working subjects.
// All writes share operation ordering with replica open/sync.
export class WorkspaceWrites {
  constructor({ sources, graphs, io, state, operations }) {
    this.sources = sources
    this.graphs = graphs
    this.io = io
    this.state = state
    this.operations = operations
  }

  async createIn(sourceOrId, object, options = {}) {
    const descriptor = this.sources.resolveCreateSource(sourceOrId)

    if (descriptor.readOnly) {
      throw new Error(`solid-workspace: source ${descriptor.id} is read-only`)
    }

    object = this.graphs.create(descriptor, object)

    if (options.save === false) {
      return object
    }

    const result = await this.save(object, options)
    if (!result.ok) {
      throw result.error ?? new Error(`solid-workspace: create failed: ${result.status}`, { cause: result })
    }
    return object
  }

  save(object, options = {}) {
    const record = this.graphs.recordFor(object)
    if (!record) {
      return Promise.reject(new Error('solid-workspace: cannot save an object that is not tracked by this workspace'))
    }
    if (record.source.logicalResource) {
      record.deleted = isDeleted(object)
    }
    const key = record.source.logicalResource ?? record.source.id
    this.operations.admit(key)
    const snapshot = this.graphs.snapshot(record.sourceUrl)
    return this.operations.sequence(key, () => this.saveRecord(record, options, snapshot))
  }

  async saveRecord(record, options, snapshot) {
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
        const response = await this.io.write(record.source, snapshot, options)
        record.sourceUrl = record.source.url
        record.created = false
        this.state.source(record.source, { state: 'ready', error: null })
        const syncTo = options.syncTo ?? record.source.syncTo
        if (syncTo) {
          this.state.pending(record.source.id, this.sources.resolveSources(syncTo))
        }
        return updateRecordStatus(record, {
          ok: true,
          status: record.deleted ? 'deleted' : 'saved',
          response
        })
      }

      if (record.deleted) {
        const response = await this.io.remove(record.sourceUrl, options)
        this.graphs.installGraph(record.source, null)
        this.state.source(record.source, { state: 'ready', error: null })
        return updateRecordStatus(record, { ok: true, status: 'deleted', response })
      }

      const source = { ...record.source, url: record.sourceUrl }
      const response = record.created
        ? await this.io.create(source, snapshot, options)
        : await this.io.write(source, snapshot, options)
      const created = record.created
      if (record.source.createContainer && response.location) {
        this.graphs.relocate(record, response.location)
      }
      record.created = false
      this.state.source(record.source, { state: 'ready', error: null })
      return updateRecordStatus(record, {
        ok: true, status: created ? 'created' : 'saved', response
      })
    }
    catch (error) {
      this.state.source(record.source, {
        state: sourceFailureState(error),
        error
      })
      return updateRecordStatus(record, { ok: false, status: 'error', error })
    }
  }

  async delete(object, options = {}) {
    const record = this.graphs.recordFor(object)

    if (!record) {
      throw new Error('solid-workspace: cannot delete an object that is not tracked by this workspace')
    }

    if (record.readOnly) {
      return statusFor(record, {
        ok: false,
        status: 'read_only',
        error: new Error('solid-workspace: source is read-only')
      })
    }
    const wasDeleted = record.deleted
    const rollback = record.source.logicalResource ? markDeleted(object) : null
    record.deleted = true
    if (options.save === false) {
      record.status = 'deleted_pending'
      return statusFor(record, { ok: true, status: record.status })
    }

    const result = await this.save(object, options)
    if (!result.ok) {
      record.deleted = wasDeleted
      rollback?.()
    }
    return result
  }

  async saveAll(records) {
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
}

function validateRecord(record) {
  if (record.source.shape) {
    return record.source.shape.fails(record.object)
  }
  return false
}
