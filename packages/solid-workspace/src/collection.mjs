import oldm from '@muze-nl/oldm'
import { writeSubjectToGraph } from './graphs.mjs'
import { isDeleted } from './replicas.mjs'
import { from } from '@muze-nl/jaqt'
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
    const className = this.descriptor.shape?.for
    return from(this.workspace.sourceSubjects(this.descriptor.sources))
      .where(object => !isDeleted(object))
      .where(object => !this.workspace.recordFor(object)?.deleted)
      .where(object => !className || oldm.many(object.a).includes(className))
      .toArray()
  }

  get(id) {
    return this.list().find(object => object.id === id) ?? null
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
    if (changes.id != null && changes.id !== object.id) {
      throw new Error('solid-workspace: an update cannot change subject identity')
    }
    if (!this.workspace.recordFor(object)) {
      throw new Error('solid-workspace: cannot update a detached subject')
    }
    return writeSubjectToGraph({
      graph: object.graph, subject: changes, id: object.id, replace: true
    })
  }

  delete(object, options = {}) {
    return this.workspace.delete(object, options)
  }

  save(object, options = {}) {
    return this.workspace.save(object, options)
  }

  saveAll() {
    const className = this.descriptor.shape?.for
    const subjects = this.workspace.sourceSubjects(this.descriptor.sources)
      .filter(object => !className || oldm.many(object.a).includes(className))
    return this.workspace.saveAll(subjects)
  }
}
