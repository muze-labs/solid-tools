import assert from 'node:assert/strict'
import test from 'node:test'
import { lading } from '../src/index.mjs'

async function loadMetro() {
  try {
    const imported = await import('@muze-nl/metro')
    return imported.default ?? imported
  } catch {
    return null
  }
}

const metro = await loadMetro()

function metroTest(name, fn) {
  if (!metro) {
    return test(name, { skip: '@muze-nl/metro is not installed in this checkout' }, fn)
  }
  return test(name, fn)
}

function mockOidcServer({ token = 'test-token' } = {}) {
  return async function mockOidcServer(req, next) {
    if (req.url.startsWith('https://issuer.example/')) {
      return metro.response({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: '{"issuer":"https://issuer.example/"}',
        url: req.url
      })
    }

    return next(req.with({
      headers: {
        Authorization: `Bearer ${token}`
      }
    }))
  }
}

function mockSolidStoragePod({ token = 'test-token' } = {}) {
  const requests = []
  const resources = new Map([
    ['https://pod.example/storage/private.txt', {
      body: 'secret',
      etag: '"private"',
      type: 'text/plain'
    }]
  ])

  function solidResponse(options) {
    return metro.response({
      headers: {},
      url: options.url,
      ...options
    })
  }

  async function pod(req, next) {
    if (!req.url.startsWith('https://pod.example/')) {
      return next(req)
    }

    requests.push(req)

    if (req.url.includes('/storage/private') && req.headers.get('Authorization') !== `Bearer ${token}`) {
      return solidResponse({
        status: 401,
        statusText: 'Unauthorized',
        url: req.url
      })
    }

    if (req.method === 'GET' && req.url === 'https://pod.example/profile#me') {
      return solidResponse({
        status: 200,
        headers: { 'Content-Type': 'text/turtle' },
        url: req.url,
        body: {
          primary: {
            space$storage: { id: 'https://pod.example/storage' },
            solid$oidcIssuer: { id: 'https://issuer.example/' },
            ldp$inbox: { id: 'https://pod.example/inbox/' }
          }
        }
      })
    }

    if (req.method === 'GET' && req.url === 'https://pod.example/storage/notes/') {
      return solidResponse({
        status: 200,
        headers: { 'Content-Type': 'text/turtle' },
        url: req.url,
        body: {
          primary: {
            ldp$contains: [
              { id: 'https://pod.example/storage/notes/a.txt' },
              { id: 'https://pod.example/storage/notes/b.txt' }
            ]
          }
        }
      })
    }

    if (req.method === 'GET' && resources.has(req.url)) {
      const resource = resources.get(req.url)
      return solidResponse({
        status: 200,
        headers: {
          'Content-Type': resource.type,
          ETag: resource.etag
        },
        url: req.url,
        body: resource.body
      })
    }

    if (req.method === 'PUT') {
      const exists = resources.has(req.url)
      if (exists && req.headers.get('If-None-Match') === '*') {
        return solidResponse({
          status: 412,
          statusText: 'Precondition Failed',
          url: req.url
        })
      }

      resources.set(req.url, {
        body: req.data,
        etag: '"created"',
        type: req.headers.get('Content-Type') ?? 'application/octet-stream'
      })
      return solidResponse({
        status: 201,
        headers: { ETag: '"created"' },
        url: req.url
      })
    }

    if (req.method === 'POST' && req.url === 'https://pod.example/storage/notes/') {
      const location = 'https://pod.example/storage/notes/a.txt'
      resources.set(location, {
        body: req.data,
        etag: '"abc"',
        type: req.headers.get('Content-Type') ?? 'application/octet-stream'
      })
      return solidResponse({
        status: 201,
        headers: {
          Location: location,
          ETag: '"abc"'
        },
        url: req.url
      })
    }

    return solidResponse({
      status: 404,
      statusText: 'Not Found',
      url: req.url
    })
  }

  pod.requests = requests
  pod.resources = resources
  return pod
}

metroTest('lading works with a real Metro client and Solid pod middleware', async () => {
  const pod = mockSolidStoragePod()
  const oidc = mockOidcServer()
  const client = metro.client('https://pod.example/', pod, oidc)
  const solid = lading(client)

  await solid.resource('/storage/notes/new.txt').create('hello', { contentType: 'text/plain' })
  await solid.container('/storage/projects').create()
  const created = await solid.container('/storage/notes').post('hello', {
    slug: 'a.txt',
    contentType: 'text/plain'
  })
  const contains = await solid.container('/storage/notes').contains()
  const profile = await solid.discoverWebId('https://pod.example/profile#me')

  assert.equal(created.location, 'https://pod.example/storage/notes/a.txt')
  assert.equal(created.etag, '"abc"')
  assert.deepEqual(contains.map(item => item.url), [
    'https://pod.example/storage/notes/a.txt',
    'https://pod.example/storage/notes/b.txt'
  ])
  assert.deepEqual(profile.storage, ['https://pod.example/storage/'])

  const putRequest = pod.requests.find(req => req.method === 'PUT' && req.url.endsWith('/new.txt'))
  assert.equal(putRequest.headers.get('If-None-Match'), '*')
  assert.equal(putRequest.headers.get('Content-Type'), 'text/plain')
  assert.equal(putRequest.headers.get('Authorization'), 'Bearer test-token')

  const containerRequest = pod.requests.find(req => req.method === 'PUT' && req.url.endsWith('/projects/'))
  assert.equal(containerRequest.headers.get('Link'), '<http://www.w3.org/ns/ldp#BasicContainer>; rel="type"')
  assert.equal(containerRequest.headers.get('If-None-Match'), '*')
})

metroTest('thrower false leaves authorization responses from a real Metro middleware chain', async () => {
  const pod = mockSolidStoragePod()
  const unauthenticated = lading(metro.client('https://pod.example/', pod), { thrower: false })
  const response = await unauthenticated.resource('/storage/private.txt').get()

  assert.equal(response.status, 401)

  const authenticated = lading(metro.client('https://pod.example/', pod, mockOidcServer()))
  const ok = await authenticated.resource('/storage/private.txt').get()

  assert.equal(ok.status, 200)
  assert.equal(pod.requests.at(-1).headers.get('Authorization'), 'Bearer test-token')
})
