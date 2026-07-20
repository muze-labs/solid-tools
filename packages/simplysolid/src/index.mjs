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

    this.solid = normalized.client ?? config.workspace?.solid ?? null
    this.conventions = normalized.conventions
    this.settings = normalized.settings
    this.registrations = normalized.registrations
    this.status = {
      state: 'idle',
      error: null,
      profile: config.profile ?? null,
      storage: normalizeStorage(config.storage),
      setup: setupStatus('unknown', normalized.conventions, normalized.registrations),
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

  dataset(options = {}) {
    return this.workspace.dataset(options)
  }

  async syncResources(options = {}) {
    this.status.state = 'syncing'
    this.status.error = null

    try {
      const status = await this.workspace.sync(options)

      for (const handle of Object.values(this.data)) {
        handle.refresh()
      }

      this.status.state = 'ready'
      this.status.lastSync = new Date()
      return status
    } catch (error) {
      this.status.state = 'error'
      this.status.error = error
      throw error
    }
  }

  async checkSetup() {
    if (!this.solid) {
      this.status.setup = setupStatus('unknown', this.conventions, this.registrations, {
        error: new Error('simplysolid: setup checks require a Lading client')
      })
      return this.status.setup
    }

    const checks = []

    for (const url of this.conventions.requiredContainers) {
      checks.push(await checkContainer(this.solid, url))
    }

    const missing = checks.filter(check => check.status === 'missing')
    const repair = checks.filter(check => check.status === 'error')
    const state = repair.length > 0 ? 'repair-needed' : missing.length > 0 ? 'setup-needed' : 'ready'

    this.status.setup = setupStatus(state, this.conventions, this.registrations, {
      checks,
      needed: missing,
      repair
    })

    return this.status.setup
  }

  async setup() {
    const setup = await this.checkSetup()

    if (setup.state === 'ready') {
      return setup
    }

    if (setup.state === 'repair-needed') {
      return setup
    }

    this.status.setup = {
      ...setup,
      state: 'creating'
    }

    const created = []
    const repair = []

    for (const item of setup.needed) {
      try {
        const response = await this.solid.container(item.url).create()
        created.push({ ...item, response })
      } catch (error) {
        repair.push({ ...item, status: 'error', error })
      }
    }

    if (repair.length > 0) {
      this.status.setup = setupStatus('repair-needed', this.conventions, this.registrations, {
        created,
        repair
      })
      return this.status.setup
    }

    return this.checkSetup()
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
    const conventions = setupConventions(config, {
      sources: config.workspace.sources ?? [],
      collections: config.workspace.collections ?? {}
    })

    return {
      client: null,
      sources: [],
      collections: {},
      conventions,
      settings: settingsFor(config, conventions),
      registrations: registrationsFor(config, conventions)
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

  const sources = [...explicitSources, ...generatedSources]
  const conventions = setupConventions(config, { sources, collections })

  return {
    client,
    sources,
    collections,
    conventions,
    settings: settingsFor(config, conventions),
    registrations: registrationsFor(config, conventions)
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

function setupConventions(config, normalized) {
  const storage = firstStorage(config.storage)
  const appId = config.app?.id ?? config.id ?? defaultAppId()
  const appSlug = config.app?.slug ?? config.slug ?? slugFrom(appId)
  const appStorage = ensureSlash(config.appStorage ?? config.setup?.appStorage ?? (
    storage ? new URL(`apps/${appSlug}/`, storage).href : null
  ))
  const settingsUrl = config.settings?.url ?? config.setup?.settingsUrl ?? (
    appStorage ? new URL('settings.ttl', appStorage).href : null
  )
  const sourceContainers = (normalized.sources ?? [])
    .filter(source => source.kind === 'container')
    .map(source => source.url)
  const requiredContainers = unique([
    appStorage,
    ...sourceContainers,
    ...(config.setup?.containers ?? [])
  ].filter(Boolean).map(ensureSlash))

  return {
    appId,
    appSlug,
    appStorage,
    settingsUrl,
    requiredContainers
  }
}

function settingsFor(config, conventions) {
  return {
    url: conventions.settingsUrl,
    data: config.settings?.data ?? {},
    shape: config.settings?.shape ?? null
  }
}

function registrationsFor(config, conventions) {
  if (config.registrations) {
    return config.registrations
  }

  const data = config.data ?? config.collections ?? {}

  return Object.entries(data)
    .map(([name, descriptor]) => {
      if (!descriptor?.shape?.class) {
        return null
      }

      const sourceUrl = descriptor.path && conventions.appStorage
        ? new URL(descriptor.path, firstStorage(config.storage)).href
        : descriptor.url ?? null

      return {
        collection: name,
        forClass: descriptor.shape.class,
        instanceContainer: sourceUrl?.endsWith('/') ? sourceUrl : null,
        instance: sourceUrl && !sourceUrl.endsWith('/') ? sourceUrl : null,
        private: descriptor.private ?? true,
        registered: false
      }
    })
    .filter(Boolean)
}

function setupStatus(state, conventions, registrations, options = {}) {
  return {
    state,
    needed: options.needed ?? [],
    repair: options.repair ?? [],
    checks: options.checks ?? [],
    created: options.created ?? [],
    error: options.error ?? null,
    appStorage: conventions.appStorage,
    settingsUrl: conventions.settingsUrl,
    registrations
  }
}

async function checkContainer(client, url) {
  try {
    const response = await client.container(url).head()
    const status = response?.status ?? 200

    if (status === 404) {
      return { url, status: 'missing', response }
    }

    if (status >= 400) {
      return { url, status: 'error', response }
    }

    return { url, status: 'ready', response }
  } catch (error) {
    const status = error.cause?.status ?? error.response?.status

    if (status === 404) {
      return { url, status: 'missing', error }
    }

    return { url, status: 'error', error }
  }
}

function defaultAppId() {
  const location = globalThis.location?.href

  if (!location) {
    return 'app'
  }

  const url = new URL(location)
  url.hash = ''
  return url.href
}

function slugFrom(value) {
  const input = String(value)
  let source = input

  try {
    const url = new URL(input)
    source = url.pathname.split('/').filter(Boolean).at(-1) ?? url.hostname
  } catch {
    source = input
  }

  return source
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'app'
}

function ensureSlash(url) {
  return url && !String(url).endsWith('/') ? `${url}/` : url
}

function unique(values) {
  return [...new Set(values)]
}

export default simplySolid
