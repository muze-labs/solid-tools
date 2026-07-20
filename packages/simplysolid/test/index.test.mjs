import assert from 'node:assert/strict'
import test from 'node:test'
import { field, shape } from '@muze-labs/oldm-shape'
import { solid } from '@muze-labs/solid-workspace'
import { packageName, simplySolid } from '../src/index.mjs'

test('simplysolid exports package name', () => {
  assert.equal(packageName, '@muze-labs/simplysolid')
})

test('simplySolid exposes app.solid status and collection handles', async () => {
  const ContactShape = contactShape()
  const ada = {
    id: 'https://pod.example/contacts/ada.ttl#me',
    rdf$type: 'schema$Person',
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
  await app.solid.sync()

  assert.equal(app.solid, service)
  assert.equal(app.data.solid, service.status)
  assert.equal(service.status.state, 'ready')
  assert.equal(service.status.setup.appStorage, 'https://pod.example/storage/apps/app/')
  assert.equal(service.status.setup.settingsUrl, 'https://pod.example/storage/apps/app/settings.ttl')
  assert.deepEqual(service.data.contacts.list(), [ada])
  assert.equal(service.data.contacts.get(ada.id), ada)
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
      forClass: 'schema$Person',
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
    rdf$type: 'schema$Person',
    schema$name: 'Ada'
  })
  const updated = await service.data.contacts.update(ada, {
    schema$name: 'Ada Lovelace'
  })
  const deleted = await service.data.contacts.delete(updated)

  assert.equal(ada.schema$email.length, 0)
  assert.equal(updated.schema$name, 'Ada Lovelace')
  assert.equal(deleted.status, 'deleted')
  assert.equal(service.data.contacts.status.state, 'ready')
  assert.deepEqual(client.calls, [
    ['container.post', 'https://pod.example/storage/contacts/', ada],
    ['resource.put', 'https://pod.example/storage/contacts/urn%3Auuid%3Aada.ttl', ada],
    ['resource.delete', 'https://pod.example/storage/contacts/urn%3Auuid%3Aada.ttl']
  ])
})

test('dataset and syncResources delegate open-world resource sync through the workspace', async () => {
  const local = {
    id: 'urn:contact:local',
    rdf$type: 'schema$Person',
    schema$name: 'Local'
  }
  const remote = {
    id: 'urn:contact:remote',
    rdf$type: 'schema$Person',
    schema$name: 'Remote'
  }
  const client = createSolidDouble({
    resources: {
      'https://pod.example/storage/local.ttl': graphDocument([local]),
      'https://pod.example/storage/remote.ttl': graphDocument([remote])
    }
  })
  const service = simplySolid({
    solid: client,
    storage: 'https://pod.example/storage/',
    sources: [
      solid.resource('https://pod.example/storage/local.ttl', { id: 'local' }),
      solid.resource('https://pod.example/storage/remote.ttl', { id: 'remote' })
    ]
  })

  await service.sync()
  const dataset = service.dataset()
  const status = await service.syncResources({
    from: ['local'],
    into: 'remote'
  })

  assert.equal(dataset.subjects.length, 2)
  assert.equal(status.status, 'synced')
  assert.deepEqual(status.document.subjects, [remote, local])
})

test('local-first collections open and persist through IndexedDB without Solid', async () => {
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
          database: 'simplysolid-test',
          key: 'contacts',
          indexedDB
        },
        shape: ContactShape
      }
    }
  })

  await service.open()
  const ada = await service.data.contacts.create({
    id: 'urn:contact:ada',
    rdf$type: 'schema$Person',
    schema$name: 'Ada'
  })

  assert.deepEqual(service.data.contacts.list(), [ada])
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
          database: 'simplysolid-test',
          key: 'contacts',
          indexedDB
        },
        shape: ContactShape
      }
    }
  })

  await next.open()

  assert.deepEqual(next.data.contacts.list(), [ada])
  assert.deepEqual(next.dataset('contacts').subjects, [ada])
})

test('connect adds a remote replica and syncs a local-first collection', async () => {
  const indexedDB = createIndexedDBDouble()
  const ContactShape = contactShape()
  const localContact = {
    id: 'urn:contact:local',
    rdf$type: 'schema$Person',
    schema$name: 'Local'
  }
  const remoteContact = {
    id: 'urn:contact:remote',
    rdf$type: 'schema$Person',
    schema$name: 'Remote'
  }
  const savedLocalContact = {
    ...localContact,
    schema$email: []
  }
  const client = createSolidDouble({
    resources: {
      'https://pod.example/storage/contacts.ttl': graphDocument([remoteContact])
    }
  })
  const service = simplySolid({
    localFirst: true,
    data: {
      contacts: {
        kind: 'resource',
        local: {
          database: 'simplysolid-test-connect',
          key: 'contacts',
          indexedDB
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
  assert.deepEqual(status.document.subjects, [remoteContact, savedLocalContact])
  assert.deepEqual(service.data.contacts.list(), [remoteContact, savedLocalContact])
  assert.equal(service.status.resources.contacts.state, 'ready')
  assert.deepEqual(client.calls, [
    ['resource.get', 'https://pod.example/storage/contacts.ttl'],
    ['resource.get', 'https://pod.example/storage/contacts.ttl'],
    ['resource.put', 'https://pod.example/storage/contacts.ttl', status.document]
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
      rdf$type: 'schema$Person'
    }),
    error => {
      assert.equal(error.message, 'solid-workspace: contacts object does not match its shape')
      assert.equal(error.validation.ok, false)
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
    rdf$type: 'schema$Person',
    schema$name: 'Ada'
  }, { save: false })

  assert.deepEqual(service.data.contacts.list(), [ada])
  assert.deepEqual(client.calls, [])

  const statuses = await service.data.contacts.saveAll()

  assert.equal(statuses[0].status, 'created')
  assert.deepEqual(client.calls, [
    ['container.post', 'https://pod.example/storage/contacts/', ada]
  ])
})

function contactShape() {
  return shape({
    class: 'schema$Person',
    fields: {
      schema$name: field.string({ min: 1, max: 1 }),
      schema$email: field.string({ many: true, default: () => [] })
    }
  })
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
      return {
        objectStore() {
          return createObjectStoreDouble(store)
        }
      }
    },
    close() {}
  }
}

function createObjectStoreDouble(store) {
  return {
    get(key) {
      return indexedDBSuccess(cloneJson(store.values.get(key)))
    },
    put(value) {
      store.values.set(value[store.keyPath], cloneJson(value))
      return indexedDBSuccess(value)
    }
  }
}

function indexedDBSuccess(value) {
  const request = {}
  queueMicrotask(() => {
    request.result = value
    request.onsuccess?.({ target: request })
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
    resource(url) {
      return {
        async get() {
          calls.push(['resource.get', url])
          return responseFor(url, resources[url])
        },
        async put(body) {
          calls.push(['resource.put', url, body])
          resources[url] = body
          return responseFor(url, body)
        },
        async create(body) {
          calls.push(['resource.create', url, body])
          resources[url] = body
          return responseFor(url, body)
        },
        async delete() {
          calls.push(['resource.delete', url])
          delete resources[url]
          return responseFor(url, null, { status: 204 })
        }
      }
    },
    container(url) {
      return {
        async head() {
          calls.push(['container.head', url])
          if (Object.hasOwn(errorContainers, url)) {
            return responseFor(url, null, { status: errorContainers[url] })
          }
          return responseFor(url, null, { status: missing.has(url) ? 404 : 200 })
        },
        async create() {
          calls.push(['container.create', url])
          missing.delete(url)
          containers[url] ??= []
          return responseFor(url, null, { status: 201 })
        },
        async contains() {
          calls.push(['container.contains', url])
          return (containers[url] ?? []).map(resourceUrl => ({
            id: resourceUrl,
            url: resourceUrl
          }))
        },
        async post(body) {
          calls.push(['container.post', url, body])
          const location = `${url}${encodeURIComponent(body.id ?? String(calls.length))}.ttl`
          resources[location] = body
          return {
            response: responseFor(location, body, { status: 201 }),
            location,
            etag: '"created"'
          }
        }
      }
    }
  }
}

function graphDocument(subjects) {
  return {
    format: 'oldmed-graph',
    subjects
  }
}

function responseFor(url, object, options = {}) {
  if (object?.subjects) {
    return {
      status: options.status ?? 200,
      url,
      data: object
    }
  }

  return {
    status: options.status ?? 200,
    url,
    data: object ? {
      primary: object,
      subjects: {
        [object.id ?? url]: object
      }
    } : null
  }
}
