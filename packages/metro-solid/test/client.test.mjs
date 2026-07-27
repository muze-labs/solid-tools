import assert from 'node:assert/strict'
import test from 'node:test'
import metro from '@muze-nl/metro'
import {
  solidApi,
  responseFromError,
  statusFromError
} from '../src/index.mjs'

function mockClient(handler) {
  const requests = []
  const client = metro.client('https://pod.example/', async function mockSolid(req) {
    requests.push(req)
    return handler(req, requests)
  })
  return { client, requests }
}

function response(options = {}) {
  return metro.response({
    status: 200,
    headers: {},
    url: options.url ?? 'https://pod.example/',
    ...options
  })
}

test('solidApi returns a Metro API object with Solid helpers', () => {
  const { client } = mockClient(req => response({ url: req.url }))
  const solid = solidApi(client)

  assert.ok(solid instanceof metro.API)
  assert.equal(solid.client, undefined)
  assert.equal(typeof solid.get, 'function')
  assert.equal(typeof solid.extend, 'function')
  assert.equal(typeof solid.create, 'function')
  assert.equal(typeof solid.createContainer, 'function')
  assert.equal(typeof solid.postToContainer, 'function')
  assert.equal(typeof solid.contains, 'function')
  assert.equal(typeof solid.oldm.get, 'function')
  assert.equal(solid.resource, undefined)
  assert.equal(solid.container, undefined)
})

test('solidApi accepts a base URL string and caller-defined methods', async () => {
  const originalFetch = globalThis.fetch
  const requested = []
  globalThis.fetch = async req => {
    requested.push(req)
    return new Response(`
      @prefix pims: <http://www.w3.org/ns/pim/space#>.
      @prefix solid: <http://www.w3.org/ns/solid/terms#>.

      <#me> pims:storage <https://pod.example/storage/>;
        solid:oidcIssuer <https://issuer.example/>.
    `, {
      status: 200,
      headers: { 'Content-Type': 'text/turtle' }
    })
  }

  try {
    const solid = solidApi('https://pod.example/profile/card', {
      async me() {
        return this.discoverWebId('https://pod.example/profile/card#me')
      }
    })

    const profile = await solid.me()

    assert.equal(requested[0].url, 'https://pod.example/profile/card#me')
    assert.equal(solid.oldm.graph(requested[0].url).primary, profile.profile)
    assert.deepEqual(profile.storage, ['https://pod.example/storage/'])
    assert.equal(profile.issuer, 'https://issuer.example/')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('discoverProfile requires a fully qualified WebID URL', async () => {
  const { client } = mockClient(() => response())

  await assert.rejects(
    () => solidApi(client).discoverProfile('#me'),
    TypeError
  )
})

test('solidApi extend keeps Solid helpers and adds caller methods', async () => {
  const { client, requests } = mockClient(req => response({ url: req.url }))
  const solid = solidApi(client).extend({
    async saveText(url, value) {
      return this.create(url, value, { headers: { 'Content-Type': 'text/plain' } })
    }
  })

  await solid.saveText('/notes/a.txt', 'hello')

  assert.equal(typeof solid.contains, 'function')
  assert.equal(typeof solid.oldm.get, 'function')
  assert.equal(requests[0].url, 'https://pod.example/notes/a.txt')
  assert.equal(requests[0].headers.get('Content-Type'), 'text/plain')
})

test('Solid create delegates to the configured Metro client with Solid headers', async () => {
  const { client, requests } = mockClient(req => response({
    status: req.method === 'GET' ? 200 : req.method === 'PUT' ? 201 : 205,
    url: req.url
  }))

  await solidApi(client).create('/notes/a.txt', 'hello', {
    headers: {
      'Content-Type': 'text/plain',
      'If-Match': '"abc"'
    }
  })

  assert.equal(requests[0].url, 'https://pod.example/notes/a.txt')
  assert.equal(requests[0].method, 'PUT')
  assert.equal(requests[0].data, 'hello')
  assert.equal(requests[0].headers.get('Content-Type'), 'text/plain')
  assert.equal(requests[0].headers.get('If-Match'), '"abc"')
  assert.equal(requests[0].headers.get('If-None-Match'), '*')
})

test('solidApi uses Metro API thrower semantics for non-OK responses', async () => {
  const responses = [
    response({ status: 401 }),
    response({ status: 403 })
  ]
  const { client } = mockClient(() => responses.shift())
  const solid = solidApi(client)

  await assert.rejects(() => solid.get('/private'), /401/)
  await assert.rejects(() => solid.get('/private'), /403/)
})

test('container create sends Solid container headers and safe creation precondition', async () => {
  const { client, requests } = mockClient(req => response({
    status: 201,
    url: req.url
  }))

  await solidApi(client).createContainer('/notes')

  assert.equal(requests[0].url, 'https://pod.example/notes/')
  assert.equal(requests[0].method, 'PUT')
  assert.equal(requests[0].headers.get('Link'), '<http://www.w3.org/ns/ldp#BasicContainer>; rel="type"')
  assert.equal(requests[0].headers.get('If-None-Match'), '*')
})

test('container post returns Location and ETag metadata', async () => {
  const { client } = mockClient(req => response({
    status: 201,
    url: req.url,
    headers: {
      Location: '/notes/a.txt',
      ETag: '"abc"'
    }
  }))

  const result = await solidApi(client).postToContainer('/notes', 'hello', { headers: { Slug: 'a.txt' } })

  assert.equal(result.location, '/notes/a.txt')
  assert.equal(result.etag, '"abc"')
  assert.equal(result.response.status, 201)
  assert.equal(result.response.ok, true)
})

test('container contains returns ldp:contains entries from parsed response data', async () => {
  const containedResponse = response({
    body: {
      primary: {
        ldp$contains: [
          { id: 'https://pod.example/storage/notes/a.txt' },
          'https://pod.example/storage/notes/b.txt'
        ]
      }
    }
  })
  const { client } = mockClient(() => containedResponse)

  assert.deepEqual(await solidApi(client).contains('https://pod.example/storage/notes'), [
    {
      id: 'https://pod.example/storage/notes/a.txt',
      url: 'https://pod.example/storage/notes/a.txt',
      resource: { id: 'https://pod.example/storage/notes/a.txt' },
      response: containedResponse
    },
    {
      id: 'https://pod.example/storage/notes/b.txt',
      url: 'https://pod.example/storage/notes/b.txt',
      resource: 'https://pod.example/storage/notes/b.txt',
      response: containedResponse
    }
  ])
})

test('GET of a fragment linked-data resource keeps the parsed graph', async () => {
  const profile = {
    id: 'https://pod.example/profile#me',
    pims$storage: { id: 'https://pod.example/storage/' }
  }
  const { client } = mockClient(req => response({
    url: req.url,
    body: { primary: profile }
  }))

  const graph = await solidApi(client).get('https://pod.example/profile#me')

  assert.equal(graph.primary, profile)
})

test('discoverProfile returns the requested WebID subject directly', async () => {
  const profile = {
    id: 'https://pod.example/profile#me',
    pims$storage: { id: 'https://pod.example/storage/' }
  }
  const { client } = mockClient(req => response({
    url: req.url,
    body: { primary: profile }
  }))

  assert.equal(await solidApi(client).discoverProfile('https://pod.example/profile#me'), profile)
})

test('discoverWebId consumes Metro-OLDM parsed profile data without parsing RDF itself', async () => {
  const profile = {
    id: 'https://pod.example/profile#me',
    pims$storage: [{ id: 'https://pod.example/storage/' }],
    solid$oidcIssuer: { id: 'https://issuer.example/' },
    ldp$inbox: { id: 'https://pod.example/inbox/' }
  }
  const { client } = mockClient(req => response({
    url: req.url,
    body: { primary: profile }
  }))

  const result = await solidApi(client).discoverWebId('https://pod.example/profile#me')

  assert.equal(result.profile, profile)
  assert.deepEqual(result.storage, ['https://pod.example/storage/'])
  assert.equal(result.issuer, 'https://issuer.example/')
  assert.equal(result.inbox, 'https://pod.example/inbox/')
})

test('discoverProfile rejects WebID responses without the requested subject', async () => {
  const { client } = mockClient(req => response({
    url: req.url,
    body: { subjects: [] }
  }))

  await assert.rejects(
    () => solidApi(client).discoverProfile('https://pod.example/profile#me'),
    /WebID did not resolve to a profile subject/
  )
})

test('discoverStorage returns storage roots from WebID profile data', async () => {
  const profile = {
    id: 'https://pod.example/profile#me',
    pims$storage: [
      { id: 'https://pod.example/storage' },
      { id: 'https://pod.example/archive/' }
    ]
  }
  const profileResponse = response({
    body: {
      primary: profile
    }
  })
  const { client } = mockClient(() => profileResponse)

  assert.deepEqual(await solidApi(client).discoverStorage('https://pod.example/profile#me'), [
    {
      profile,
      id: 'https://pod.example/storage/',
      url: 'https://pod.example/storage/'
    },
    {
      profile,
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
