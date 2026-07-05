export const packageName = '@muze-labs/simplysolid'

import {
  collection as workspaceCollection,
  solid,
  workspace
} from '@muze-labs/solid-workspace'

export function simplySolid(config = {}) {
  return new SimplySolid(config)
}

export class SimplySolid {
  constructor(config = {}) {
    if (!config || typeof config !== 'object') {
      throw new TypeError('simplysolid: config must be an object')
    }

    const normalized = normalizeConfig(config)

    this.status = {
      state: 'idle',
      error: null,
      profile: config.profile ?? null,
      storage: normalizeStorage(config.storage),
      collections: {}
    }
    this.workspace = config.workspace ?? workspace({
      solid: normalized.client,
      sources: normalized.sources,
      collections: normalized.collections
    })
    this.data = Object.fromEntries(
      Object.entries(this.workspace.collections).map(([name, collection]) => [
        name,
        new SimplySolidCollection(this, name, collection)
      ])
    )

    for (const name of Object.keys(this.data)) {
      this.status.collections[name] = this.data[name].status
    }
  }

  install(app) {
    app.solid = this

    if (app.data && typeof app.data === 'object') {
      app.data.solid = this.status
    }

    return this
  }

  async sync(options = {}) {
    this.status.state = 'syncing'
    this.status.error = null

    try {
      await this.workspace.load(options)

      for (const handle of Object.values(this.data)) {
        handle.refresh()
      }

      this.status.state = 'ready'
      this.status.lastSync = new Date()
      return this.data
    } catch (error) {
      this.status.state = 'error'
      this.status.error = error
      throw error
    }
  }
}

export class SimplySolidCollection {
  constructor(service, name, collection) {
    this.solid = service
    this.name = name
    this.collection = collection
    this.items = []
    this.status = {
      state: 'idle',
      error: null,
      lastSync: null,
      lastSave: null
    }
  }

  refresh() {
    this.items = this.collection.list()
    this.status.state = 'ready'
    this.status.lastSync = new Date()
    return this.items
  }

  async sync() {
    this.status.state = 'syncing'
    this.status.error = null

    try {
      await this.solid.workspace.load({
        sources: this.collection.descriptor.sources
      })
      return this.refresh()
    } catch (error) {
      this.status.state = 'error'
      this.status.error = error
      throw error
    }
  }

  list() {
    return this.refresh()
  }

  get(id) {
    return this.collection.get(id)
  }

  async create(data = {}, options = {}) {
    return this.write('creating', async () => {
      const object = await this.collection.create(data, {
        ...options,
        save: false
      })

      if (options.save === false) {
        this.refresh()
        return object
      }

      const status = await this.collection.save(object, options)
      this.status.lastSave = status
      this.refresh()
      return object
    })
  }

  async update(idOrObject, changes = {}, options = {}) {
    return this.write('saving', async () => {
      const object = this.resolve(idOrObject)
      this.collection.update(object, changes)

      if (options.save === false) {
        this.refresh()
        return object
      }

      const status = await this.collection.save(object, options)
      this.status.lastSave = status
      this.refresh()
      return object
    })
  }

  async delete(idOrObject, options = {}) {
    return this.write('deleting', async () => {
      const object = this.resolve(idOrObject)
      const status = await this.collection.delete(object, {
        ...options,
        save: options.save ?? true
      })
      this.status.lastSave = status
      this.refresh()
      return status
    })
  }

  async saveAll() {
    return this.write('saving', async () => {
      const statuses = await this.collection.saveAll()
      this.status.lastSave = statuses
      this.refresh()
      return statuses
    })
  }

  async write(state, fn) {
    this.status.state = state
    this.status.error = null

    try {
      const result = await fn()
      this.status.state = 'ready'
      return result
    } catch (error) {
      this.status.state = 'error'
      this.status.error = error
      throw error
    }
  }

  resolve(idOrObject) {
    if (typeof idOrObject === 'string') {
      const object = this.get(idOrObject)

      if (!object) {
        throw new Error(`simplysolid: ${this.name} item ${idOrObject} was not found`)
      }

      return object
    }

    if (!idOrObject || typeof idOrObject !== 'object') {
      throw new TypeError(`simplysolid: ${this.name} item must be an object or id`)
    }

    return idOrObject
  }
}

function normalizeConfig(config) {
  if (config.workspace) {
    return {
      client: null,
      sources: [],
      collections: {}
    }
  }

  const client = config.solid ?? config.lading ?? config.client

  if (!client) {
    throw new TypeError('simplysolid: a Lading client or workspace is required')
  }

  const explicitSources = config.sources ?? []
  const data = config.data ?? config.collections ?? {}
  const generatedSources = []
  const collections = {}

  for (const [name, descriptor] of Object.entries(data)) {
    const normalized = normalizeCollection(name, descriptor, config)
    collections[name] = normalized.collection

    if (normalized.source) {
      generatedSources.push(normalized.source)
    }
  }

  return {
    client,
    sources: [...explicitSources, ...generatedSources],
    collections
  }
}

function normalizeCollection(name, descriptor = {}, config = {}) {
  if (!descriptor || typeof descriptor !== 'object') {
    throw new TypeError(`simplysolid: collection ${name} must be an object`)
  }

  if (descriptor.kind === 'collection' && !descriptor.path) {
    return {
      collection: descriptor,
      source: null
    }
  }

  const source = descriptor.path
    ? sourceFromPath(name, descriptor, config)
    : null
  const sourceId = descriptor.source ?? source?.id
  const sources = descriptor.sources ?? (sourceId ? [sourceId] : [])
  const createIn = descriptor.createIn ?? sourceId ?? sources[0]

  return {
    source,
    collection: workspaceCollection({
      ...descriptor,
      sources,
      createIn
    })
  }
}

function sourceFromPath(name, descriptor, config) {
  const storage = firstStorage(config.storage)

  if (!storage) {
    throw new TypeError(`simplysolid: collection ${name} uses path but no storage root was configured`)
  }

  const url = new URL(descriptor.path, storage).href
  const options = {
    id: descriptor.source ?? name,
    readOnly: Boolean(descriptor.readOnly),
    shape: descriptor.shape ?? null,
    options: descriptor.options ?? {},
    writeOptions: descriptor.writeOptions
  }

  return descriptor.kind === 'resource' || descriptor.resource === true || !url.endsWith('/')
    ? solid.resource(url, options)
    : solid.container(url, options)
}

function normalizeStorage(storage) {
  if (!storage) {
    return []
  }

  if (Array.isArray(storage)) {
    return storage.map(storageUrl)
  }

  return [storageUrl(storage)]
}

function firstStorage(storage) {
  return normalizeStorage(storage)[0] ?? null
}

function storageUrl(storage) {
  const url = typeof storage === 'string' ? storage : storage?.url ?? storage?.id
  return url && !String(url).endsWith('/') ? `${url}/` : url
}

export default simplySolid
