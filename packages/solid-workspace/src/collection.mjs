import oldm from '@muze-nl/oldm'
import { from, matchIf } from '@muze-nl/jaqt'
import * as assert from '@muze-nl/assert'
import { Optional } from '@muze-nl/assert'

export function collection(options = {}) {
  return {
    kind: 'collection',
    ...options
  }
}

export class WorkspaceCollection {
  constructor(workspace, name, descriptor = {}) {
    assert.check(descriptor, Object, 'solid-workspace: collection descriptor must be an object', TypeError)
    assert.check(descriptor.sources, Optional(Array), 'solid-workspace: collection sources must be an array', TypeError)

    this.workspace = workspace
    this.name = name
    this.descriptor = descriptor
  }

  list() {
    const sourceIds = oldm.many(this.descriptor.sources)
      .map(source => this.workspace.sourcePatterns.get(source) ?? source)
    const className = this.descriptor.shape?.for

    return from(this.workspace.records)
      .where({
        deleted: false,
        sourceId: matchIf(sourceIds.length > 0, sourceIds),
        object: matchIf(className, { a: className })
      })
      .select(record => record.object)
      .toArray()
  }

  get(id) {
    return this.list().find(object => object.id === id || object['@id'] === id) ?? null
  }

  async create(object = {}, options = {}) {
    const createIn = options.createIn ?? this.descriptor.createIn
    if (!createIn) {
      throw new Error(`solid-workspace: collection ${this.name} needs createIn to create objects`)
    }

    let data = { ...object }
    if (this.descriptor.shape?.applyDefaults) {
      data = this.descriptor.shape.applyDefaults(object)
    }

    if (this.descriptor.shape) {
      this.descriptor.shape.assert(data, {
        message: `solid-workspace: ${this.name} object does not match its shape`
      })
    }

    return this.workspace.createIn(createIn, data, {
      ...options,
      save: options.save ?? false
    })
  }

  update(object, changes = {}) {
    Object.assign(object, changes)
    return object
  }

  delete(object, options = {}) {
    return this.workspace.delete(object, options)
  }

  save(object, options = {}) {
    return this.workspace.save(object, options)
  }

  saveAll() {
    const sourceIds = oldm.many(this.descriptor.sources)
      .map(source => this.workspace.sourcePatterns.get(source) ?? source)
    const className = this.descriptor.shape?.for

    return this.workspace.saveAll(from(this.workspace.records)
      .where({
        sourceId: matchIf(sourceIds.length > 0, sourceIds),
        object: matchIf(className, { a: className })
      })
      .toArray())
  }
}
