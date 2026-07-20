import assert from 'node:assert/strict'
import test from 'node:test'
import { collection, graph, local, mergeGraphDocuments, packageName, solid, workspace } from '../src/index.mjs'
import { field, shape } from '@muze-labs/oldm-shape'

test('solid-workspace scaffold exports source descriptors', () => {
  assert.equal(packageName, '@muze-labs/solid-workspace')
  assert.deepEqual(solid.resource('/a.ttl'), {
    kind: 'resource',
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
      return graphDocument([])
    }
  }).kind, 'resource')
})

test('loads direct resources and tracks object source urls', async () => {
  const contact = {
    id: 'https://pod.example/contacts/ada.ttl#me',
    rdf$type: 'schema$Person',
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

  assert.equal(ws.records.length, 1)
  assert.equal(ws.records[0].object, contact)
  assert.equal(ws.sourceOf(contact).sourceUrl, 'https://pod.example/contacts/ada.ttl')
  assert.deepEqual(client.calls, [
    ['resource.get', 'https://pod.example/contacts/ada.ttl']
  ])
})

test('loads container resources into collection views', async () => {
  const ContactShape = shape({
    class: 'schema$Person',
    fields: {
      schema$name: field.string({ min: 1, max: 1 })
    }
  })
  const ada = {
    id: 'https://pod.example/contacts/ada.ttl#me',
    rdf$type: 'schema$Person',
    schema$name: 'Ada'
  }
  const org = {
    id: 'https://pod.example/contacts/acme.ttl#org',
    rdf$type: 'schema$Organization',
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

  assert.deepEqual(ws.collections.contacts.list(), [ada])
  assert.equal(ws.collections.contacts.get(ada.id), ada)
})

test('creates new collection objects through createIn routing', async () => {
  const ContactShape = shape({
    class: 'schema$Person',
    fields: {
      schema$name: field.string({ min: 1, max: 1 }),
      schema$email: field.string({ many: true, default: () => [] })
    }
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
    rdf$type: 'schema$Person',
    schema$name: 'Ada'
  })
  const status = await ws.collections.contacts.save(ada)

  assert.equal(status.ok, true)
  assert.equal(status.status, 'created')
  assert.deepEqual(ada.schema$email, [])
  assert.deepEqual(client.calls, [
    ['container.post', 'https://pod.example/contacts/', ada]
  ])
})

test('updates and deletes existing tracked resources', async () => {
  const ada = {
    id: 'https://pod.example/contacts/ada.ttl#me',
    rdf$type: 'schema$Person',
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
  ada.schema$name = 'Ada Lovelace'

  const saved = await ws.save(ada)
  const deleted = await ws.delete(ada)

  assert.equal(saved.status, 'saved')
  assert.equal(deleted.status, 'deleted')
  assert.deepEqual(client.calls, [
    ['resource.get', 'https://pod.example/contacts/ada.ttl'],
    ['resource.put', 'https://pod.example/contacts/ada.ttl', ada],
    ['resource.delete', 'https://pod.example/contacts/ada.ttl']
  ])
})

test('delegates fact-level source lookup to OLDM context when available', async () => {
  const contact = {
    id: 'https://pod.example/contacts/ada.ttl#me',
    rdf$type: 'schema$Person',
    schema$name: 'Ada'
  }
  const context = {
    sources(object, predicate, value) {
      assert.equal(object, contact)
      assert.equal(predicate, 'schema$name')
      assert.equal(value, 'Ada')
      return [{ url: 'https://pod.example/profile.ttl' }]
    }
  }
  const client = createSolidDouble({
    resources: {
      'https://pod.example/contacts/ada.ttl': contact
    },
    contexts: {
      'https://pod.example/contacts/ada.ttl': context
    }
  })
  const ws = workspace({
    solid: client,
    sources: [
      solid.resource('https://pod.example/contacts/ada.ttl', { id: 'ada' })
    ]
  })

  await ws.load()

  assert.equal(ws.sourceOf(contact, 'schema$name', 'Ada').sourceUrl, 'https://pod.example/profile.ttl')
})

test('mergeGraphDocuments preserves open-world subjects and facts', () => {
  const result = mergeGraphDocuments([
    {
      format: 'oldmed-graph',
      prefixes: { schema: 'https://schema.org/' },
      subjects: [
        {
          id: 'urn:contact:ada',
          rdf$type: 'schema$Person',
          schema$name: 'Ada'
        }
      ]
    },
    {
      prefixes: { foaf: 'http://xmlns.com/foaf/0.1/' },
      subjects: [
        {
          id: 'urn:contact:ada',
          schema$email: 'ada@example.test'
        },
        {
          id: 'urn:contact:grace',
          rdf$type: 'schema$Person',
          schema$name: 'Grace'
        }
      ]
    }
  ])

  assert.equal(result.changed, true)
  assert.deepEqual(result.prefixes, {
    schema: 'https://schema.org/',
    foaf: 'http://xmlns.com/foaf/0.1/'
  })
  assert.deepEqual(result.subjects, [
    {
      id: 'urn:contact:ada',
      rdf$type: 'schema$Person',
      schema$name: 'Ada',
      schema$email: 'ada@example.test'
    },
    {
      id: 'urn:contact:grace',
      rdf$type: 'schema$Person',
      schema$name: 'Grace'
    }
  ])
})

test('workspace dataset exposes multiple resources as one open-world graph', async () => {
  const adaLocal = {
    id: 'urn:contact:ada',
    rdf$type: 'schema$Person',
    schema$name: 'Ada'
  }
  const adaRemote = {
    id: 'urn:contact:ada',
    schema$email: 'ada@example.test'
  }
  const client = createSolidDouble({
    resources: {
      'https://pod.example/local.ttl': graphDocument([adaLocal]),
      'https://pod.example/remote.ttl': graphDocument([adaRemote])
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

  assert.deepEqual(ws.dataset().subjects, [
    {
      id: 'urn:contact:ada',
      rdf$type: 'schema$Person',
      schema$name: 'Ada',
      schema$email: 'ada@example.test'
    }
  ])
})

test('workspace sync additively projects selected sources into a target resource', async () => {
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
      'https://pod.example/local.ttl': graphDocument([local]),
      'https://pod.example/remote.ttl': graphDocument([remote])
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
  const status = await ws.sync({
    from: ['local'],
    into: 'remote'
  })

  assert.equal(status.ok, true)
  assert.equal(status.status, 'synced')
  assert.deepEqual(status.document.subjects, [remote, local])
  assert.deepEqual(client.calls, [
    ['resource.get', 'https://pod.example/local.ttl'],
    ['resource.get', 'https://pod.example/remote.ttl'],
    ['resource.get', 'https://pod.example/remote.ttl'],
    ['resource.put', 'https://pod.example/remote.ttl', status.document]
  ])
})

test('local memory resources open without a Solid client and export Turtle', async () => {
  const ada = {
    id: 'urn:contact:ada',
    rdf$type: 'schema$Person',
    schema$name: 'Ada'
  }
  const localNotes = local.memory('local-contacts', {
    prefixes: { schema: 'https://schema.org/' },
    document: graphDocument([ada])
  })
  const ws = workspace({
    sources: [localNotes]
  })

  await ws.load()
  const turtle = await localNotes.turtle()

  assert.deepEqual(ws.dataset().subjects, [ada])
  assert.match(turtle, /schema:Person/)
  assert.match(turtle, /Ada/)
})

test('workspace can add a Solid source later and sync local data into it', async () => {
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
  const localSource = local.memory('local-contacts', {
    document: graphDocument([localContact])
  })
  const client = createSolidDouble({
    resources: {
      'https://pod.example/contacts.ttl': graphDocument([remoteContact])
    }
  })
  const ws = workspace({
    sources: [localSource]
  })

  await ws.load()
  ws.setClient(client)
  ws.addSource(solid.turtleResource('https://pod.example/contacts.ttl', {
    id: 'solid-contacts'
  }))
  await ws.load({ sources: ['solid-contacts'] })

  assert.deepEqual(ws.dataset().subjects, [localContact, remoteContact])

  const status = await ws.sync({
    from: ['local-contacts'],
    into: 'solid-contacts'
  })

  assert.equal(status.status, 'synced')
  assert.deepEqual(status.document.subjects, [remoteContact, localContact])
})

test('read-only sources report read_only for otherwise valid saves', async () => {
  const ContactShape = shape({
    class: 'schema$Person',
    fields: {
      schema$name: field.string({ min: 1, max: 1 })
    }
  })
  const ada = {
    id: 'https://pod.example/contacts/ada.ttl#me',
    rdf$type: 'schema$Person',
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

  const status = await ws.save(ada)

  assert.equal(status.ok, false)
  assert.equal(status.status, 'read_only')
})

test('read-only and validation failures are reported in saveAll statuses', async () => {
  const ContactShape = shape({
    class: 'schema$Person',
    fields: {
      schema$name: field.string({ min: 1, max: 1 })
    }
  })
  const ada = {
    id: 'https://pod.example/contacts/ada.ttl#me',
    rdf$type: 'schema$Person'
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
      assert.equal(error.failures[0].status, 'validation_failed')
      return true
    }
  )
})

function createSolidDouble({ resources = {}, containers = {}, contexts = {} } = {}) {
  const calls = []

  return {
    calls,
    resource(url) {
      return {
        async get() {
          calls.push(['resource.get', url])
          return responseFor(url, resources[url], { context: contexts[url] })
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
      },
      context: options.context ?? null
    } : null
  }
}
