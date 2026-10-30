import assert from 'node:assert/strict'
import test from 'node:test'
import { parseGraph, mergeGraphs } from '../src/graphs.mjs'
import { graphFixture } from './fixtures.mjs'
import { collection, graph, local, packageName, resource, solid, workspace } from '../src/index.mjs'
import { shape } from '@muze-labs/oldm-shape'

test('solid-workspace scaffold exports source descriptors', () => {
  assert.equal(packageName, '@muze-labs/solid-workspace')
  assert.deepEqual(solid.resource('/a.ttl'), {
    workspacePart: 'source',
    kind: 'resource',
    type: 'solid-resource',
    id: '/a.ttl',
    url: '/a.ttl',
    readOnly: false,
    shape: null,
    options: {}
  })
  assert.equal(graph.resource({
    id: 'memory',
    url: 'memory://notes',
    async load() {
      return graphFixture([])
    }
  }).kind, 'resource')
  assert.equal(solid.client(createSolidDouble()).workspacePart, 'client')
})

test('loads direct resources and tracks object source urls', async () => {
  const contact = {
    id: 'https://pod.example/contacts/ada.ttl#me',
    a: 'https://schema.org/Person',
    schema$name: 'Ada'
  }
  const client = createSolidDouble({
    resources: {
      'https://pod.example/contacts/ada.ttl': contact
    }
  })
  const ws = workspace({
    solid: client,
    sources: [
      solid.resource('https://pod.example/contacts/ada.ttl', { id: 'ada' })
    ]
  })

  await ws.load()

  const loaded = ws.graph('ada').get(contact.id)
  assert.equal(ws.sourceOf(loaded).record.object, loaded)
  assert.notEqual(loaded, contact)
  assertGraphEqual(loaded, contact)
  assert.equal(ws.sourceOf(loaded).sourceUrl, 'https://pod.example/contacts/ada.ttl')
  assert.deepEqual(client.calls, [
    ['resource.get', 'https://pod.example/contacts/ada.ttl']
  ])
})

test('loads container resources into collection views', async () => {
  const ContactShape = shape('https://schema.org/Person', {
    schema$name: String
  })
  const ada = {
    id: 'https://pod.example/contacts/ada.ttl#me',
    a: 'https://schema.org/Person',
    schema$name: 'Ada'
  }
  const org = {
    id: 'https://pod.example/contacts/acme.ttl#org',
    a: 'https://schema.org/Organization',
    schema$name: 'Acme'
  }
  const client = createSolidDouble({
    containers: {
      'https://pod.example/contacts/': [
        'https://pod.example/contacts/ada.ttl',
        'https://pod.example/contacts/acme.ttl'
      ]
    },
    resources: {
      'https://pod.example/contacts/ada.ttl': ada,
      'https://pod.example/contacts/acme.ttl': org
    }
  })
  const ws = workspace({
    solid: client,
    sources: [
      solid.container('https://pod.example/contacts/', { id: 'contacts' })
    ],
    collections: {
      contacts: collection({
        shape: ContactShape,
        sources: ['contacts'],
        createIn: 'contacts'
      })
    }
  })

  await ws.load()

  assertGraphEqual(ws.collections.contacts.list(), [ada])
  assert.equal(ws.collections.contacts.get(ada.id), ws.context.graph('https://pod.example/contacts/ada.ttl').get(ada.id))
})

test('creates new collection objects through createIn routing', async () => {
  const ContactShape = shape('https://schema.org/Person', {
    schema$name: String
  })
  ContactShape.applyDefaults = object => ({
    schema$email: [],
    ...object
  })
  const client = createSolidDouble()
  const ws = workspace({
    solid: client,
    sources: [
      solid.container('https://pod.example/contacts/', { id: 'contacts' })
    ],
    collections: {
      contacts: collection({
        shape: ContactShape,
        sources: ['contacts'],
        createIn: 'contacts'
      })
    }
  })

  const ada = await ws.collections.contacts.create({
    id: 'urn:uuid:ada',
    a: 'https://schema.org/Person',
    schema$name: 'Ada'
  })
  const status = await ws.collections.contacts.save(ada)

  assert.equal(status.ok, true)
  assert.equal(status.status, 'created')
  assert.deepEqual(ada.schema$email, [])
  const posted = parseGraph(client.calls[0][2], { url: 'https://pod.example/contacts/ada.ttl' })
  assert.equal(String(posted.subjects[ada.id].schema$name), 'Ada')
  assert.deepEqual(client.calls, [
    ['container.post', 'https://pod.example/contacts/', client.calls[0][2]]
  ])
})

test('collection create requires an explicit createIn target', async () => {
  const ContactShape = shape('https://schema.org/Person', {
    schema$name: String
  })
  const ws = workspace({
    sources: [
      local.memory('contacts')
    ],
    collections: {
      contacts: collection({
        shape: ContactShape,
        sources: ['contacts']
      })
    }
  })

  await assert.rejects(
    () => ws.collections.contacts.create({
      id: 'urn:uuid:ada',
      a: 'https://schema.org/Person',
      schema$name: 'Ada'
    }),
    /collection contacts needs createIn/
  )
})

test('updates and deletes existing tracked resources', async () => {
  const ada = {
    id: 'https://pod.example/contacts/ada.ttl#me',
    a: 'https://schema.org/Person',
    schema$name: 'Ada'
  }
  const client = createSolidDouble({
    resources: {
      'https://pod.example/contacts/ada.ttl': ada
    }
  })
  const ws = workspace({
    solid: client,
    sources: [
      solid.resource('https://pod.example/contacts/ada.ttl', { id: 'ada' })
    ]
  })

  await ws.load()
  const loaded = ws.graph('ada').get(ada.id)
  loaded.schema$name = 'Ada Lovelace'

  const saved = await ws.save(loaded)
  const deleted = await ws.delete(loaded)

  assert.equal(saved.status, 'saved')
  assert.equal(deleted.status, 'deleted')
  const written = parseGraph(client.calls[1][2], { url: 'https://pod.example/contacts/ada.ttl' })
  assert.equal(String(written.subjects[ada.id].schema$name), 'Ada Lovelace')
  assert.deepEqual(client.calls, [
    ['resource.get', 'https://pod.example/contacts/ada.ttl'],
    ['resource.put', 'https://pod.example/contacts/ada.ttl', client.calls[1][2]],
    ['resource.delete', 'https://pod.example/contacts/ada.ttl']
  ])
})

test('fact-level source lookup uses the workspace context', async () => {
  const id = 'https://pod.example/contacts/ada.ttl#me'
  const ws = workspace({
    sources: [local.memory('ada', {
      turtle: `<${id}> <https://schema.org/name> "Ada" .`
    })]
  })
  await ws.open()
  const contact = ws.context.get(id)
  assert.equal(ws.sourceOf(contact, 'schema$name', 'Ada').source.id, 'ada')
  assert.deepEqual(ws.sourcesOf(contact, 'schema$name', 'Grace'), [])
})


test('workspace context exposes multiple resources as one open-world graph', async () => {
  const adaLocal = {
    id: 'urn:contact:ada',
    a: 'https://schema.org/Person',
    schema$name: 'Ada'
  }
  const adaRemote = {
    id: 'urn:contact:ada',
    schema$email: 'ada@example.test'
  }
  const client = createSolidDouble({
    resources: {
      'https://pod.example/local.ttl': graphFixture([adaLocal]),
      'https://pod.example/remote.ttl': graphFixture([adaRemote])
    }
  })
  const ws = workspace({
    solid: client,
    sources: [
      solid.resource('https://pod.example/local.ttl', { id: 'local' }),
      solid.resource('https://pod.example/remote.ttl', { id: 'remote' })
    ]
  })

  await ws.load()

  assertGraphEqual(ws.context.data, [
    {
      id: 'urn:contact:ada',
      a: 'https://schema.org/Person',
      schema$name: 'Ada',
      schema$email: 'ada@example.test'
    }
  ])
})


test('local memory resources open without a Solid client and export Turtle', async () => {
  const ada = {
    id: 'urn:contact:ada',
    a: 'https://schema.org/Person',
    schema$name: 'Ada',
    schema$about: {
      id: 'https://example.test/topic'
    }
  }
  const localNotes = local.memory('local-contacts', {
    prefixes: { schema: 'https://schema.org/' },
    turtle: await graphFixture([ada]).write()
  })
  const ws = workspace({
    sources: [localNotes]
  })

  await ws.load()
  const turtle = await localNotes.load()

  assertGraphEqual(ws.sourceSubjects(), [ada])
  assert.equal(ws.context.data[0].schema$name instanceof String, true)
  assert.equal(ws.context.data[0].schema$name.type, 'http://www.w3.org/2001/XMLSchema#string')
  assertGraphEqual(ws.context.data[0].schema$about, {
    id: 'https://example.test/topic'
  })
  assert.match(turtle, /schema:Person/)
  assert.match(turtle, /Ada/)
})

test('local indexedDB resources persist Turtle across workspaces', async () => {
  const indexedDB = createIndexedDBDouble()
  const ada = {
    id: 'urn:contact:ada',
    a: 'https://schema.org/Person',
    schema$name: 'Ada'
  }

  const first = workspace()
    .add(resource('contacts', {
      local: local.indexedDB('solid-workspace-test', {
        id: 'contacts:local',
        key: 'contacts',
        indexedDB,
        prefixes: { schema: 'https://schema.org/' }
      })
    }))

  await first.open('contacts')
  await first.createIn('contacts', ada)
  const stored = indexedDB.databases
    .get('solid-workspace-test')
    .stores
    .get('resources')
    .values
    .get('contacts')

  assert.equal(typeof stored.turtle, 'string')
  assert.equal(stored.document, undefined)
  assert.match(stored.turtle, /schema:Person/)

  const second = workspace()
    .add(resource('contacts', {
      local: local.indexedDB('solid-workspace-test', {
        id: 'contacts:local',
        key: 'contacts',
        indexedDB,
        prefixes: { schema: 'https://schema.org/' }
      })
    }))

  await second.open('contacts')
  const turtle = await second.resources[0].local.load()

  assertGraphEqual(second.graph('contacts').data, [ada])
  assert.equal(second.graph('contacts').data[0].schema$name instanceof String, true)
  assert.equal(second.graph('contacts').data[0].schema$name.type, 'http://www.w3.org/2001/XMLSchema#string')
  assert.match(turtle, /schema:Person/)
  assert.match(turtle, /Ada/)
})

test('workspace can add a Solid source later and sync local data into it', async () => {
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
  const localSource = local.memory('local-contacts', {
    turtle: await graphFixture([localContact]).write()
  })
  const client = createSolidDouble({
    resources: {
      'https://pod.example/contacts.ttl': graphFixture([remoteContact])
    }
  })
  const ws = workspace()
    .add(resource('contacts', { local: localSource }))

  await ws.open()
  ws
    .add(solid.client(client))
    .add(resource('contacts', {
      remote: solid.resource('https://pod.example/contacts.ttl', {
        id: 'solid-contacts'
      })
    }))
  await ws.open('contacts')

  assertGraphEqual(ws.context.data, [localContact, remoteContact])

  const status = await ws.sync('contacts')

  assert.equal(status.status, 'synced')
  assertGraphEqual(status.graph.data, [remoteContact, localContact])
})

test('workspace add accepts explicit factory-created parts and arrays of parts', () => {
  const ws = workspace()
  const localSource = local.memory('local-contacts')
  const settingsSource = local.memory('local-settings')

  assert.equal(ws.add(localSource), ws)
  assert.equal(ws.sources[0], localSource)
  assert.equal(ws.add([settingsSource]), ws)
  assert.deepEqual(ws.sources, [localSource, settingsSource])
  assert.equal(ws.add(resource('contacts', {
    local: local.memory('contacts:local')
  })), ws)
  assert.equal(ws.resources[0].id, 'contacts')
  assert.throws(
    () => ws.add({
      kind: 'resource',
      id: 'not-factory-made',
      url: 'memory://not-factory-made'
    }),
    /add\(\) expects a workspace part from a factory/
  )
})

test('open keeps local data when a remote source is unavailable', async () => {
  const localContact = {
    id: 'urn:contact:local',
    a: 'https://schema.org/Person',
    schema$name: 'Local'
  }
  const ws = workspace()
    .add([
      local.memory('local-contacts', {
        turtle: await graphFixture([localContact]).write()
      }),
      solid.resource('https://pod.example/offline.ttl', {
        id: 'solid-contacts'
      })
    ])

  await ws.open()

  assertGraphEqual(ws.context.data, [localContact])
  assert.equal(ws.status.state, 'ready')
  assert.equal(ws.status.sources['local-contacts'].state, 'ready')
  assert.equal(ws.status.sources['solid-contacts'].state, 'offline')
  assert.equal(ws.status.lastOpen.failures.length, 1)
})

test('load remains strict when a source cannot be opened', async () => {
  const ws = workspace()
    .add(solid.resource('https://pod.example/offline.ttl', {
      id: 'solid-contacts'
    }))

  await assert.rejects(
    () => ws.load(),
    /Solid API client is required/
  )
  assert.equal(ws.status.state, 'error')
  assert.equal(ws.status.sources['solid-contacts'].state, 'offline')
})

test('local saves can mark a remote source sync-pending until sync succeeds', async () => {
  const localContact = {
    id: 'urn:contact:local',
    a: 'https://schema.org/Person',
    schema$name: 'Local'
  }
  const client = createSolidDouble({
    resources: {
      'https://pod.example/contacts.ttl': graphFixture([])
    }
  })
  const ws = workspace()
    .add(resource('contacts', {
      local: local.memory('local-contacts'),
      remote: solid.resource('https://pod.example/contacts.ttl', {
        id: 'solid-contacts'
      })
    }))

  await ws.open('local-contacts')
  await ws.createIn('local-contacts', localContact, {
    syncTo: 'solid-contacts'
  })

  assert.equal(ws.status.sources['solid-contacts'].state, 'sync-pending')
  assert.equal(ws.status.sources['solid-contacts'].syncPending, true)
  assert.deepEqual(ws.status.sources['solid-contacts'].pendingFrom, ['local-contacts'])

  ws.add(solid.client(client))
  const status = await ws.sync('contacts')

  assert.equal(status.status, 'synced')
  assert.equal(ws.status.sources['solid-contacts'].state, 'ready')
  assert.equal(ws.status.sources['solid-contacts'].syncPending, false)
  assert.deepEqual(ws.status.sources['solid-contacts'].pendingFrom, [])
})

test('logical resources store reachable remote data in the local working copy', async () => {
  const remoteContact = {
    id: 'urn:contact:remote',
    a: 'https://schema.org/Person',
    schema$name: 'Remote'
  }
  const localReplica = local.memory('contacts:local', {
    turtle: await graphFixture([]).write()
  })
  const remoteReplica = solid.resource('https://pod.example/contacts.ttl', {
    id: 'contacts:solid'
  })
  const client = createSolidDouble({
    resources: {
      'https://pod.example/contacts.ttl': graphFixture([remoteContact])
    }
  })
  const online = workspace()
    .add([
      solid.client(client),
      resource('contacts', {
        local: localReplica,
        remote: remoteReplica
      })
    ])

  await online.open()

  assertGraphEqual(online.graph('contacts').data, [remoteContact])

  const offline = workspace()
    .add(resource('contacts', {
      local: localReplica,
      remote: remoteReplica
    }))

  await offline.open('contacts')

  assertGraphEqual(offline.graph('contacts').data, [remoteContact])
  assert.equal(offline.status.sources['contacts:local'].state, 'ready')
  assert.equal(offline.status.sources['contacts:solid'].state, 'offline')
  assert.equal(offline.status.resources.contacts.state, 'ready')
})

test('logical resources save offline locally and sync additively later', async () => {
  const originalRemote = {
    id: 'urn:contact:remote',
    a: 'https://schema.org/Person',
    schema$name: 'Remote'
  }
  const offlineLocal = {
    id: 'urn:contact:local',
    a: 'https://schema.org/Person',
    schema$name: 'Local'
  }
  const laterRemote = {
    id: 'urn:contact:later-remote',
    a: 'https://schema.org/Person',
    schema$name: 'Later Remote'
  }
  const localReplica = local.memory('contacts:local', {
    turtle: await graphFixture([originalRemote]).write()
  })
  const remoteReplica = solid.resource('https://pod.example/contacts.ttl', {
    id: 'contacts:solid'
  })
  const ws = workspace()
    .add(resource('contacts', {
      local: localReplica,
      remote: remoteReplica
    }))

  await ws.open('contacts')
  await ws.createIn('contacts', offlineLocal)

  assertGraphEqual(ws.graph('contacts').data, [originalRemote, offlineLocal])
  assert.equal(ws.status.sources['contacts:solid'].state, 'sync-pending')
  assert.equal(ws.status.sources['contacts:solid'].syncPending, true)

  const client = createSolidDouble({
    resources: {
      'https://pod.example/contacts.ttl': graphFixture([originalRemote, laterRemote])
    }
  })

  ws.add(solid.client(client))
  const status = await ws.sync('contacts')

  assert.equal(status.ok, true)
  assert.equal(status.status, 'synced')
  assertGraphEqual(status.graph.data, [originalRemote, laterRemote, offlineLocal])
  assertGraphEqual(ws.graph('contacts').data, [originalRemote, laterRemote, offlineLocal])
  assert.equal(ws.status.sources['contacts:solid'].state, 'ready')
  assert.equal(ws.status.sources['contacts:solid'].syncPending, false)
  assert.deepEqual(client.calls, [
    ['resource.get', 'https://pod.example/contacts.ttl'],
    ['resource.put', 'https://pod.example/contacts.ttl', client.calls.at(-1)[2]]
  ])
})

test('read-only sources report read_only for otherwise valid saves', async () => {
  const ContactShape = shape('https://schema.org/Person', {
    schema$name: String
  })
  const ada = {
    id: 'https://pod.example/contacts/ada.ttl#me',
    a: 'https://schema.org/Person',
    schema$name: 'Ada'
  }
  const client = createSolidDouble({
    resources: {
      'https://pod.example/contacts/ada.ttl': ada
    }
  })
  const ws = workspace({
    solid: client,
    sources: [
      solid.resource('https://pod.example/contacts/ada.ttl', {
        id: 'ada',
        readOnly: true,
        shape: ContactShape
      })
    ]
  })

  await ws.load()

  const status = await ws.save(ws.graph('ada').get(ada.id))

  assert.equal(status.ok, false)
  assert.equal(status.status, 'read_only')
})

test('read-only and validation failures are reported in saveAll statuses', async () => {
  const ContactShape = shape('https://schema.org/Person', {
    schema$name: String
  })
  const ada = {
    id: 'https://pod.example/contacts/ada.ttl#me',
    a: 'https://schema.org/Person'
  }
  const client = createSolidDouble({
    resources: {
      'https://pod.example/contacts/ada.ttl': ada
    }
  })
  const ws = workspace({
    solid: client,
    sources: [
      solid.resource('https://pod.example/contacts/ada.ttl', {
        id: 'ada',
        readOnly: true,
        shape: ContactShape
      })
    ]
  })

  await ws.load()

  await assert.rejects(
    () => ws.saveAll(),
    error => {
      assert.equal(error.message, 'solid-workspace: saveAll failed')
      assert.equal(error.cause.failures[0].status, 'validation_failed')
      assert.equal(error.cause.failures[0].issues[0].pathString, 'schema$name')
      return true
    }
  )
})

function createIndexedDBDouble() {
  const databases = new Map()

  return {
    databases,
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

function createSolidDouble({ resources = {}, containers = {}, contexts = {} } = {}) {
  const calls = []

  return {
    calls,
    async get(url) {
      calls.push(['resource.get', url])
      if (!resources[url]) {
        throw new Error('404: Not Found', {
          cause: responseFor(url, null, { status: 404, statusText: 'Not Found' })
        })
      }
      return dataFor(url, resources[url], { context: contexts[url] })
    },
    async put(url, options = {}) {
      calls.push(['resource.put', url, options.body])
      resources[url] = typeof options.body === 'string' ? parseGraph(options.body, { url }) : options.body
      return responseFor(url, options.body)
    },
    async delete(url) {
      calls.push(['resource.delete', url])
      delete resources[url]
      return responseFor(url, null, { status: 204 })
    },
    async create(url, body) {
      calls.push(['resource.create', url, body])
      resources[url] = body
      return responseFor(url, body)
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
    data: object ? dataFor(url, object, options) : null
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


test('merge deduplicates plain and full-IRI xsd:string literals', () => {
  const text = Object.assign(new String('same text'), {type: 'http://www.w3.org/2001/XMLSchema#string'})
  const merged = mergeGraphs([
    graphFixture([{id: 'urn:test:one', schema$name: 'same text'}]),
    graphFixture([{id: 'urn:test:one', schema$name: text}])
  ])
  assert.equal(merged.subjects['urn:test:one'].schema$name, 'same text')
})
