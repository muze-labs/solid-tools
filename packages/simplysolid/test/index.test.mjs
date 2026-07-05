import assert from 'node:assert/strict'
import test from 'node:test'
import { field, shape } from '@muze-labs/oldm-shape'
import { packageName, simplySolid } from '../src/index.mjs'

test('simplysolid scaffold exports package name', () => {
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
  assert.deepEqual(service.data.contacts.list(), [ada])
  assert.equal(service.data.contacts.get(ada.id), ada)
  assert.deepEqual(client.calls, [
    ['container.contains', 'https://pod.example/storage/contacts/'],
    ['resource.get', 'https://pod.example/storage/contacts/ada.ttl']
  ])
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

function createSolidDouble({ resources = {}, containers = {} } = {}) {
  const calls = []

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

function responseFor(url, object, options = {}) {
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
