import assert from 'node:assert/strict'
import test from 'node:test'
import {
  lading,
  responseFromError,
  statusFromError,
  storageFromProfile,
  storageUrlsFromProfile
} from '../src/index.mjs'

test('resource methods delegate to direct Metro verb methods', async () => {
  const calls = []
  const metro = {
    async get(url, options) {
      calls.push({ method: 'get', url, options })
      return { ok: true, status: 200, headers: {} }
    },
    async put(url, options) {
      calls.push({ method: 'put', url, options })
      return { ok: true, status: 201, headers: {} }
    },
    async patch(url, options) {
      calls.push({ method: 'patch', url, options })
      return { ok: true, status: 205, headers: {} }
    },
    async delete(url, options) {
      calls.push({ method: 'delete', url, options })
      return { ok: true, status: 205, headers: {} }
    }
  }

  const solid = lading(metro)
  const resource = solid.resource('/notes/a.txt')

  await resource.get({ accept: 'text/plain', ifNoneMatch: '"old"' })
  await resource.put('hello', { contentType: 'text/plain', ifMatch: '"abc"' })
  await resource.patch('patch', { contentType: 'application/sparql-update' })
  await resource.delete({ ifMatch: '"def"' })

  assert.deepEqual(calls.map(call => call.method), ['get', 'put', 'patch', 'delete'])
  assert.equal(calls[0].url, '/notes/a.txt')
  assert.equal(calls[0].options.headers.Accept, 'text/plain')
  assert.equal(calls[0].options.headers['If-None-Match'], '"old"')
  assert.equal(calls[1].options.body, 'hello')
  assert.equal(calls[1].options.headers['Content-Type'], 'text/plain')
  assert.equal(calls[1].options.headers['If-Match'], '"abc"')
  assert.equal(calls[2].options.body, 'patch')
  assert.equal(calls[2].options.headers['Content-Type'], 'application/sparql-update')
  assert.equal(calls[3].options.headers['If-Match'], '"def"')
})

test('resource create uses If-None-Match by default for safe writes', async () => {
  const calls = []
  const metro = {
    async put(url, options) {
      calls.push({ url, options })
      return { ok: true, status: 201, headers: {} }
    }
  }

  await lading(metro).resource('/notes/a.txt').create('hello', { contentType: 'text/plain' })

  assert.equal(calls[0].url, '/notes/a.txt')
  assert.equal(calls[0].options.body, 'hello')
  assert.equal(calls[0].options.headers['Content-Type'], 'text/plain')
  assert.equal(calls[0].options.headers['If-None-Match'], '*')
})

test('lading can add a supplied thrower middleware when the client supports with()', async () => {
  let middleware = null
  const base = {
    with(mw) {
      middleware = mw
      return this
    },
    async get() {
      return { ok: true, status: 200, headers: {} }
    }
  }

  const solid = lading(base, {
    thrower() {
      return response => response
    }
  })
  await solid.resource('/ok').get()

  assert.equal(typeof middleware, 'function')
})

test('thrower false leaves 401 and 403 responses for the caller', async () => {
  const responses = [
    { ok: false, status: 401, headers: {} },
    { ok: false, status: 403, headers: {} }
  ]
  const metro = {
    with() {
      throw new Error('thrower should not be added')
    },
    async get() {
      return responses.shift()
    }
  }
  const solid = lading(metro, { thrower: false })

  assert.equal((await solid.resource('/private').get()).status, 401)
  assert.equal((await solid.resource('/private').get()).status, 403)
})

test('container create sends Solid container headers and safe creation precondition', async () => {
  const calls = []
  const metro = {
    async put(url, options) {
      calls.push({ url, options })
      return { ok: true, status: 201, headers: {} }
    }
  }

  await lading(metro).container('/notes').create()

  assert.equal(calls[0].url, '/notes/')
  assert.equal(calls[0].options.body, '')
  assert.equal(calls[0].options.headers.Link, '<http://www.w3.org/ns/ldp#BasicContainer>; rel="type"')
  assert.equal(calls[0].options.headers['If-None-Match'], '*')
})

test('container post returns Location and ETag metadata', async () => {
  const metro = {
    async post() {
      return {
        ok: true,
        status: 201,
        headers: {
          Location: '/notes/a.txt',
          ETag: '"abc"'
        }
      }
    }
  }

  const result = await lading(metro).container('/notes').post('hello', { slug: 'a.txt' })

  assert.equal(result.location, '/notes/a.txt')
  assert.equal(result.etag, '"abc"')
  assert.equal(result.response.status, 201)
  assert.equal(result.response.ok, true)
})

test('container contains returns ldp:contains entries from parsed response data', async () => {
  const response = {
    ok: true,
    status: 200,
    headers: {},
    data: {
      primary: {
        ldp$contains: [
          { id: 'https://pod.example/storage/notes/a.txt' },
          'https://pod.example/storage/notes/b.txt'
        ]
      }
    }
  }
  const metro = {
    async get() {
      return response
    }
  }

  assert.deepEqual(await lading(metro).container('https://pod.example/storage/notes').contains(), [
    {
      id: 'https://pod.example/storage/notes/a.txt',
      url: 'https://pod.example/storage/notes/a.txt',
      resource: { id: 'https://pod.example/storage/notes/a.txt' },
      response
    },
    {
      id: 'https://pod.example/storage/notes/b.txt',
      url: 'https://pod.example/storage/notes/b.txt',
      resource: 'https://pod.example/storage/notes/b.txt',
      response
    }
  ])
})

test('discoverWebId consumes Metro-OLDM parsed profile data without parsing RDF itself', async () => {
  const metro = {
    async get() {
      return {
        ok: true,
        status: 200,
        headers: {},
        data: {
          primary: {
            space$storage: [{ id: 'https://pod.example/storage/' }],
            solid$oidcIssuer: { id: 'https://issuer.example/' },
            ldp$inbox: { id: 'https://pod.example/inbox/' }
          }
        }
      }
    }
  }

  const profile = await lading(metro).discoverWebId('https://pod.example/profile#me')

  assert.deepEqual(profile.storage, ['https://pod.example/storage/'])
  assert.equal(profile.issuer, 'https://issuer.example/')
  assert.equal(profile.inbox, 'https://pod.example/inbox/')
})

test('storageUrlsFromProfile reads all supported Solid storage predicates', () => {
  const profile = {
    space$storage: [
      { id: 'https://pod.example/storage' },
      { id: 'https://pod.example/archive/' }
    ],
    pim$storage: 'https://pod.example/storage/',
    solid$storage: { id: 'https://pod.example/other' }
  }

  assert.deepEqual(storageUrlsFromProfile(profile), [
    'https://pod.example/storage/',
    'https://pod.example/archive/',
    'https://pod.example/other/'
  ])
})

test('storageFromProfile keeps profile and response context for callers', () => {
  const response = { status: 200 }
  const profile = { space$storage: { id: 'https://pod.example/storage' } }

  assert.deepEqual(storageFromProfile(profile, { response }), [{
    profile,
    response,
    id: 'https://pod.example/storage/',
    url: 'https://pod.example/storage/'
  }])
})

test('discoverStorage returns storage roots from WebID profile data', async () => {
  const response = {
    ok: true,
    status: 200,
    headers: {},
    data: {
      primary: {
        space$storage: { id: 'https://pod.example/storage' },
        pim$storage: { id: 'https://pod.example/archive/' }
      }
    }
  }
  const metro = {
    async get() {
      return response
    }
  }

  assert.deepEqual(await lading(metro).discoverStorage('https://pod.example/profile#me'), [
    {
      profile: response.data.primary,
      response,
      id: 'https://pod.example/storage/',
      url: 'https://pod.example/storage/'
    },
    {
      profile: response.data.primary,
      response,
      id: 'https://pod.example/archive/',
      url: 'https://pod.example/archive/'
    }
  ])
})

test('errors remain Metro thrower errors with the response in cause', () => {
  const response = { status: 404 }
  const error = new Error('404: Not Found', { cause: response })

  assert.equal(responseFromError(error), response)
  assert.equal(statusFromError(error), 404)
})
