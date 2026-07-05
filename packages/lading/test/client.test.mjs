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
    async put(url, options) {
      calls.push({ method: 'put', url, options })
      return { ok: true, status: 201, headers: {} }
    }
  }

  const solid = lading(metro)
  await solid.resource('/notes/a.txt').put('hello', { contentType: 'text/plain' })

  assert.equal(calls[0].method, 'put')
  assert.equal(calls[0].url, '/notes/a.txt')
  assert.equal(calls[0].options.body, 'hello')
  assert.equal(calls[0].options.headers['Content-Type'], 'text/plain')
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
