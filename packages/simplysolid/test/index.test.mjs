import { parseGraph } from '../../solid-workspace/src/graphs.mjs'
import { graphFixture } from '../../solid-workspace/test/fixtures.mjs'
import assert from 'node:assert/strict'
import test from 'node:test'
import { field, Optional, shape } from '@muze-labs/oldm-shape'
import { packageName, simplySolid } from '../src/index.mjs'

test('simplysolid exports package name', () => {
  assert.equal(packageName, '@muze-labs/simplysolid')
})

test('simplySolid exposes app.solid status and collection handles', async () => {
  const ContactShape = contactShape()
  const ada = {
    id: 'https://pod.example/contacts/ada.ttl#me',
    a: 'https://schema.org/Person',
    schema$name: 'Ada'
  }
  const client = createSolidDouble({
    containers: {
      'https://pod.example/storage/contacts/': [
        'https://pod.example/storage/contacts/ada.ttl'
      ]
    },
    resources: {
      'https://pod.example/storage/contacts/ada.ttl': ada
    }
  })
  const service = simplySolid({
    solid: client,
    storage: 'https://pod.example/storage/',
    data: {
      contacts: {
        path: 'contacts/',
        shape: ContactShape
      }
    }
  })
  const app = { data: {} }

  service.install(app)
  await app.solid.open()

  assert.equal(app.solid, service)
  assert.equal(app.data.solid, service.status)
  assert.equal(service.status.state, 'ready')
  assert.equal(service.status.setup.appStorage, 'https://pod.example/storage/apps/app/')
  assert.equal(service.status.setup.settingsUrl, 'https://pod.example/storage/apps/app/settings.ttl')
  assertGraphEqual(service.data.contacts.list(), graphValue([ada]))
  assert.equal(service.data.contacts.get(ada.id), service.workspace.context.graph('https://pod.example/storage/contacts/ada.ttl').get(ada.id))
  assert.deepEqual(client.calls, [
    ['container.contains', 'https://pod.example/storage/contacts/'],
    ['resource.get', 'https://pod.example/storage/contacts/ada.ttl']
  ])
})

test('setup conventions expose app storage, settings, and registrations', () => {
  const service = simplySolid({
    solid: createSolidDouble(),
    storage: 'https://pod.example/storage/',
    app: {
      id: 'https://apps.example/contacts/',
      slug: 'contacts'
    },
    data: {
      contacts: {
        path: 'contacts/',
        shape: contactShape()
      }
    }
  })

  assert.equal(service.conventions.appStorage, 'https://pod.example/storage/apps/contacts/')
  assert.equal(service.settings.url, 'https://pod.example/storage/apps/contacts/settings.ttl')
  assert.deepEqual(service.registrations, [
    {
      collection: 'contacts',
      forClass: 'https://schema.org/Person',
      instanceContainer: 'https://pod.example/storage/contacts/',
      instance: null,
      private: true,
      registered: false
    }
  ])
  assert.deepEqual(service.conventions.requiredContainers, [
    'https://pod.example/storage/apps/contacts/',
    'https://pod.example/storage/contacts/'
  ])
})

test('checkSetup reports setup-needed and setup creates missing containers', async () => {
  const client = createSolidDouble({
    missingContainers: [
      'https://pod.example/storage/apps/contacts/',
      'https://pod.example/storage/contacts/'
    ]
  })
  const service = simplySolid({
    solid: client,
    storage: 'https://pod.example/storage/',
    app: {
      slug: 'contacts'
    },
    data: {
      contacts: {
        path: 'contacts/',
        shape: contactShape()
      }
    }
  })

  const first = await service.checkSetup()

  assert.equal(first.state, 'setup-needed')
  assert.deepEqual(first.needed.map(item => item.url), [
    'https://pod.example/storage/apps/contacts/',
    'https://pod.example/storage/contacts/'
  ])

  const next = await service.setup()

  assert.equal(next.state, 'ready')
  assert.deepEqual(client.calls, [
    ['container.head', 'https://pod.example/storage/apps/contacts/'],
    ['container.head', 'https://pod.example/storage/contacts/'],
    ['container.head', 'https://pod.example/storage/apps/contacts/'],
    ['container.head', 'https://pod.example/storage/contacts/'],
    ['container.create', 'https://pod.example/storage/apps/contacts/'],
    ['container.create', 'https://pod.example/storage/contacts/'],
    ['container.head', 'https://pod.example/storage/apps/contacts/'],
    ['container.head', 'https://pod.example/storage/contacts/']
  ])
})

test('checkSetup reports repair-needed for inaccessible containers', async () => {
  const service = simplySolid({
    solid: createSolidDouble({
      errorContainers: {
        'https://pod.example/storage/contacts/': 403
      }
    }),
    storage: 'https://pod.example/storage/',
    setup: {
      appStorage: 'https://pod.example/storage/app/'
    },
    data: {
      contacts: {
        path: 'contacts/',
        shape: contactShape()
      }
    }
  })

  const setup = await service.checkSetup()

  assert.equal(setup.state, 'repair-needed')
  assert.equal(setup.repair[0].url, 'https://pod.example/storage/contacts/')
})

test('collection create, update, and delete delegate through solid-workspace', async () => {
  const ContactShape = contactShape()
  const client = createSolidDouble()
  const service = simplySolid({
    solid: client,
    storage: 'https://pod.example/storage/',
    data: {
      contacts: {
        path: 'contacts/',
        shape: ContactShape
      }
    }
  })

  const ada = await service.data.contacts.create({
    id: 'urn:uuid:ada',
    a: 'https://schema.org/Person',
    schema$name: 'Ada'
  })
  const updated = await service.data.contacts.update(ada, {
    schema$name: 'Ada Lovelace'
  })
  const deleted = await service.data.contacts.delete(updated)

  assert.equal(Object.hasOwn(ada, 'schema$email'), false)
  assert.equal(updated.schema$name, 'Ada Lovelace')
  const initial = parseGraph(client.calls[0][2], { url: 'https://pod.example/storage/contacts/' })
  const edited = parseGraph(client.calls[1][2], { url: 'https://pod.example/storage/contacts/' })
  assert.equal(String(initial.subjects[ada.id].schema$name), 'Ada')
  assert.equal(String(edited.subjects[ada.id].schema$name), 'Ada Lovelace')
  assert.equal(deleted.status, 'deleted')
  assert.equal(service.data.contacts.status.state, 'ready')
  assert.deepEqual(client.calls, [
    ['container.post', 'https://pod.example/storage/contacts/', client.calls[0][2]],
    ['resource.put', 'https://pod.example/storage/contacts/urn%3Auuid%3Aada.ttl', client.calls[1][2]],
    ['resource.delete', 'https://pod.example/storage/contacts/urn%3Auuid%3Aada.ttl']
  ])
})


test('local-first collections open and persist through IndexedDB as Turtle without Solid', async () => {
  const indexedDB = createIndexedDBDouble()
  const ContactShape = contactShape()
  const service = simplySolid({
    localFirst: true,
    app: {
      slug: 'contacts'
    },
    data: {
      contacts: {
        kind: 'resource',
        local: {
          indexedDB: 'simplysolid-test',
          key: 'contacts',
          indexedDBFactory: indexedDB
        },
        shape: ContactShape
      }
    }
  })

  await service.open()
  const ada = await service.data.contacts.create({
    id: 'urn:contact:ada',
    a: 'https://schema.org/Person',
    schema$name: 'Ada'
  })
  const persistedAda = {
    id: 'urn:contact:ada',
    a: 'https://schema.org/Person',
    schema$name: 'Ada'
  }

  assertGraphEqual(service.data.contacts.list(), graphValue([ada]))
  assert.equal(service.workspace.status.resources.contacts.state, 'ready')

  const next = simplySolid({
    localFirst: true,
    app: {
      slug: 'contacts'
    },
    data: {
      contacts: {
        kind: 'resource',
        local: {
          indexedDB: 'simplysolid-test',
          key: 'contacts',
          indexedDBFactory: indexedDB
        },
        shape: ContactShape
      }
    }
  })

  await next.open()

  assertGraphEqual(next.data.contacts.list(), [persistedAda])
  assertGraphEqual(next.workspace.graph('contacts').data, [persistedAda])
  assert.equal(next.data.contacts.list()[0].schema$name instanceof String, true)
  assert.equal(next.data.contacts.list()[0].schema$name.type, 'http://www.w3.org/2001/XMLSchema#string')
})

test('connect adds a remote replica and syncs a local-first collection', async () => {
  const indexedDB = createIndexedDBDouble()
  const ContactShape = contactShape()
  const localContact = {
    id: 'urn:contact:local',
    a: 'https://schema.org/Person',
    schema$name: 'Local'
  }
  const remoteContact = {
    id: 'urn:contact:remote',
    a: 'https://schema.org/Person',
    schema$name: 'Remote'
  }
  const client = createSolidDouble({
    resources: {
      'https://pod.example/storage/contacts.ttl': graphFixture([remoteContact])
    }
  })
  const service = simplySolid({
    localFirst: true,
    data: {
      contacts: {
        kind: 'resource',
        local: {
          indexedDB: 'simplysolid-test-connect',
          key: 'contacts',
          indexedDBFactory: indexedDB
        },
        shape: ContactShape
      }
    }
  })

  await service.open()
  await service.data.contacts.create(localContact)
  await service.connect({
    solid: client,
    resources: {
      contacts: {
        url: 'https://pod.example/storage/contacts.ttl'
      }
    }
  })
  const status = await service.sync('contacts')

  assert.equal(status.status, 'synced')
  assertGraphEqual(status.graph.data, [remoteContact, localContact])
  assertGraphEqual(service.data.contacts.list(), [remoteContact, localContact])
  assert.equal(service.status.resources.contacts.state, 'ready')
  assert.deepEqual(client.calls, [
    ['resource.get', 'https://pod.example/storage/contacts.ttl'],
    ['resource.get', 'https://pod.example/storage/contacts.ttl'],
    ['resource.put', 'https://pod.example/storage/contacts.ttl', client.calls.at(-1)[2]]
  ])
})

test('collection create validates through oldm-shape before writing', async () => {
  const client = createSolidDouble()
  const service = simplySolid({
    solid: client,
    storage: 'https://pod.example/storage/',
    data: {
      contacts: {
        path: 'contacts/',
        shape: contactShape()
      }
    }
  })

  await assert.rejects(
    () => service.data.contacts.create({
      a: 'https://schema.org/Person'
    }),
    error => {
      assert.equal(error.message, 'solid-workspace: contacts object does not match its shape')
      assert.equal(error.cause.issues[0].pathString, 'schema$name')
      return true
    }
  )
  assert.deepEqual(client.calls, [])
  assert.equal(service.data.contacts.status.state, 'error')
})

test('collection handles can create locally before saveAll', async () => {
  const client = createSolidDouble()
  const service = simplySolid({
    solid: client,
    storage: 'https://pod.example/storage/',
    data: {
      contacts: {
        path: 'contacts/',
        shape: contactShape()
      }
    }
  })

  const ada = await service.data.contacts.create({
    a: 'https://schema.org/Person',
    schema$name: 'Ada'
  }, { save: false })

  assertGraphEqual(service.data.contacts.list(), graphValue([ada]))
  assert.deepEqual(client.calls, [])

  const statuses = await service.data.contacts.saveAll()

  assert.equal(statuses[0].status, 'created')
  assert.deepEqual(client.calls, [
    ['container.post', 'https://pod.example/storage/contacts/', client.calls[0][2]]
  ])
})

function contactShape() {
  return shape('https://schema.org/Person', {
    schema$name: field('schema$name', String),
    schema$email: Optional(field('schema$email', [String]))
  })
}

function assertGraphEqual(actual, expected) {
  assert.deepEqual(graphValue(actual), expected)
}

function graphValue(value) {
  if (Array.isArray(value)) {
    return value.map(graphValue)
  }

  if (value instanceof String || value instanceof Number || value instanceof Boolean) {
    return value.valueOf()
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, graphValue(item)])
    )
  }

  return value
}

function createIndexedDBDouble() {
  const databases = new Map()

  return {
    open(name, version) {
      const request = {}
      queueMicrotask(() => {
        let state = databases.get(name)
        const upgradeNeeded = !state
        if (!state) {
          state = {
            version,
            stores: new Map()
          }
          databases.set(name, state)
        }
        request.result = createDatabaseDouble(state)
        if (upgradeNeeded) {
          request.onupgradeneeded?.({ target: request })
        }
        request.onsuccess?.({ target: request })
      })
      return request
    }
  }
}

function createDatabaseDouble(state) {
  return {
    objectStoreNames: {
      contains(name) {
        return state.stores.has(name)
      }
    },
    createObjectStore(name, options = {}) {
      const store = {
        keyPath: options.keyPath ?? 'key',
        values: new Map()
      }
      state.stores.set(name, store)
      return createObjectStoreDouble(store)
    },
    transaction(name) {
      const store = state.stores.get(name)
      if (!store) {
        throw new Error(`missing object store ${name}`)
      }
      const transaction = {
        objectStore() {
          return createObjectStoreDouble(store, transaction)
        }
      }
      return transaction
    },
    close() {}
  }
}

function createObjectStoreDouble(store, transaction) {
  return {
    get(key) {
      return indexedDBSuccess(cloneJson(store.values.get(key)), transaction)
    },
    put(value) {
      store.values.set(value[store.keyPath], cloneJson(value))
      return indexedDBSuccess(value, transaction)
    }
  }
}

function indexedDBSuccess(value, transaction) {
  const request = {}
  queueMicrotask(() => {
    request.result = value
    request.onsuccess?.({ target: request })
    transaction?.oncomplete?.()
  })
  return request
}

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value))
}

function createSolidDouble({
  resources = {},
  containers = {},
  missingContainers = [],
  errorContainers = {}
} = {}) {
  const calls = []
  const missing = new Set(missingContainers)

  return {
    calls,
    async get(url) {
      calls.push(['resource.get', url])
      if (!resources[url]) {
        throw new Error('404: Not Found', {
          cause: responseFor(url, null, { status: 404, statusText: 'Not Found' })
        })
      }
      return dataFor(url, resources[url])
    },
    async put(url, options = {}) {
      calls.push(['resource.put', url, options.body])
      resources[url] = options.body
      return responseFor(url, options.body)
    },
    async delete(url) {
      calls.push(['resource.delete', url])
      delete resources[url]
      return responseFor(url, null, { status: 204 })
    },
    async head(url) {
      calls.push(['container.head', url])
      if (Object.hasOwn(errorContainers, url)) {
        return responseFor(url, null, { status: errorContainers[url] })
      }
      return responseFor(url, null, { status: missing.has(url) ? 404 : 200 })
    },
    async create(url, body) {
      calls.push(['resource.create', url, body])
      resources[url] = body
      return responseFor(url, body)
    },
    async createContainer(url) {
      calls.push(['container.create', url])
      missing.delete(url)
      containers[url] ??= []
      return responseFor(url, null, { status: 201 })
    },
    async contains(url) {
      calls.push(['container.contains', url])
      return (containers[url] ?? []).map(resourceUrl => ({
        id: resourceUrl,
        url: resourceUrl
      }))
    },
    async postToContainer(url, body) {
      calls.push(['container.post', url, body])
      const parsed = parseGraph(body, { url })
      const location = `${url}${encodeURIComponent(parsed.data[0].id)}.ttl`
      resources[location] = body
      return {
        response: responseFor(location, body, { status: 201 }),
        location,
        etag: '"created"'
      }
    }
  }
}

function responseFor(url, object, options = {}) {
  return {
    status: options.status ?? 200,
    statusText: options.statusText ?? 'OK',
    url,
    data: object ? dataFor(url, object) : null
  }
}

function dataFor(url, object) {
  if (typeof object === 'string') {
    return parseGraph(object, { url })
  }
  if (object?.subjects) {
    return object
  }

  return graphFixture([object], { url })
}
