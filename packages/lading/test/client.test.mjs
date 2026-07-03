import assert from 'node:assert/strict'
import test from 'node:test'
import { lading, responseFromError, statusFromError } from '../src/index.mjs'

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

test('lading adds Metro thrower middleware when the client supports with()', async () => {
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

  const solid = lading(base)
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

test('errors remain Metro thrower errors with the response in cause', () => {
  const response = { status: 404 }
  const error = new Error('404: Not Found', { cause: response })

  assert.equal(responseFromError(error), response)
  assert.equal(statusFromError(error), 404)
})
