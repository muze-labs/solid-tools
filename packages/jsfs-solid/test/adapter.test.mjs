import assert from 'node:assert/strict'
import test from 'node:test'
import metro from '@muze-nl/metro'
import { SolidAdapter, solidFs } from '../src/index.mjs'

function ensureSlash(url) {
  return String(url).endsWith('/') ? String(url) : `${url}/`
}

function response(body, options = {}) {
  const headers = new Headers(options.headers ?? {})
  return {
    status: options.status ?? 200,
    headers,
    url: options.url,
    body,
    data: options.data,
    async text() {
      return String(body)
    },
    async json() {
      return JSON.parse(String(body))
    },
    async blob() {
      return new Blob([body], { type: headers.get('Content-Type') ?? undefined })
    }
  }
}

function createSolidDouble() {
  const calls = []

  return {
    calls,
    metro: metro.client('https://pod.example/storage/', async req => {
      const method = req.method.toLowerCase()
      calls.push({
        kind: 'client',
        method,
        url: req.url,
        body: req.data,
        headers: Object.fromEntries(req.headers.entries())
      })
      if (method === 'get') {
        return response('hello', {
          url: req.url,
          headers: { 'Content-Type': 'text/plain' }
        })
      }
      if (method === 'put') {
        return response('', {
          status: 201,
          url: req.url,
          headers: { ETag: '"write"' }
        })
      }
      if (method === 'delete') {
        return response('', { status: 205, url: req.url })
      }
      if (method === 'head') {
        return response('', { status: 200, url: req.url })
      }
      return response('', { status: 405, url: req.url })
    }),
    async contains(url, options) {
      const containerUrl = ensureSlash(url)
      calls.push({ kind: 'solid', method: 'contains', url: containerUrl, options })
      return [
        {
          id: 'https://pod.example/storage/notes/a.txt',
          resource: { id: 'https://pod.example/storage/notes/a.txt' }
        },
        {
          id: 'https://pod.example/storage/notes/archive/',
          resource: {
            id: 'https://pod.example/storage/notes/archive/',
            a: ['http://www.w3.org/ns/ldp#Container']
          }
        }
      ]
    },
    async createContainer(url, options) {
      const containerUrl = ensureSlash(url)
      calls.push({ kind: 'solid', method: 'createContainer', url: containerUrl, options })
      return response('', { status: 201, url: containerUrl })
    }
  }
}

test('read resolves paths and returns file-shaped text content', async () => {
  const solid = createSolidDouble()
  const adapter = new SolidAdapter('https://pod.example/storage/', {
    solid,
    metroClient: solid.metro
  })

  const file = await adapter.read('/notes/a.txt')

  assert.equal(file.name, 'a.txt')
  assert.equal(file.type, 'text/plain')
  assert.equal(file.contents, 'hello')
  assert.deepEqual(file.http, {
    headers: file.http.headers,
    status: 200,
    url: 'https://pod.example/storage/notes/a.txt'
  })
  assert.deepEqual(solid.calls, [{
    kind: 'client',
    method: 'get',
    url: 'https://pod.example/storage/notes/a.txt',
    body: undefined,
    headers: {}
  }])
})

test('write delegates resource writes to Metro-Solid with JSFS metadata', async () => {
  const solid = createSolidDouble()
  const adapter = new SolidAdapter('https://pod.example/storage/', {
    solid,
    metroClient: solid.metro
  })

  const written = await adapter.write('/notes/a.txt', 'hello', {
    type: 'text/plain',
    headers: {
      'If-Match': '"old"',
      'X-Test': 'yes'
    }
  })

  assert.equal(written.name, 'a.txt')
  assert.equal(written.type, 'text/plain')
  assert.equal(written.http.status, 201)
  assert.deepEqual(solid.calls, [{
    kind: 'client',
    method: 'put',
    url: 'https://pod.example/storage/notes/a.txt',
    body: 'hello',
    headers: {
      'content-type': 'text/plain',
      'if-match': '"old"',
      'x-test': 'yes'
    }
  }])
})

test('list maps LDP containment to JSFS entries', async () => {
  const solid = createSolidDouble()
  const adapter = new SolidAdapter('https://pod.example/storage/', {
    solid,
    metroClient: solid.metro
  })

  assert.deepEqual(await adapter.list('/notes'), [
    {
      filename: 'a.txt',
      path: '/notes/a.txt',
      url: 'https://pod.example/storage/notes/a.txt',
      type: 'file',
      resource: { id: 'https://pod.example/storage/notes/a.txt' }
    },
    {
      filename: 'archive',
      path: '/notes/archive/',
      url: 'https://pod.example/storage/notes/archive/',
      type: 'folder',
      resource: {
        id: 'https://pod.example/storage/notes/archive/',
        a: ['http://www.w3.org/ns/ldp#Container']
      }
    }
  ])

  assert.deepEqual(solid.calls, [{
    kind: 'solid',
    method: 'contains',
    url: 'https://pod.example/storage/notes/',
    options: undefined
  }])
})

test('mkdir, rmdir, and remove delegate to Metro-Solid container/resource operations', async () => {
  const solid = createSolidDouble()
  const adapter = new SolidAdapter('https://pod.example/storage/', {
    solid,
    metroClient: solid.metro
  })

  await adapter.mkdir('/notes/archive')
  await adapter.rmdir('/notes/archive')
  await adapter.remove('/notes/a.txt')

  assert.deepEqual(solid.calls, [
    {
      kind: 'solid',
      method: 'createContainer',
      url: 'https://pod.example/storage/notes/archive/',
      options: undefined
    },
    {
      kind: 'client',
      method: 'delete',
      url: 'https://pod.example/storage/notes/archive/',
      body: undefined,
      headers: {}
    },
    {
      kind: 'client',
      method: 'delete',
      url: 'https://pod.example/storage/notes/a.txt',
      body: undefined,
      headers: {}
    }
  ])
})

test('solidFs returns a JSFS filesystem wrapper around SolidAdapter', async () => {
  const solid = createSolidDouble()
  const fs = solidFs('https://pod.example/storage/', {
    solid,
    metroClient: solid.metro
  })

  const file = await fs.read('/notes/a.txt')
  await fs.write('/notes/b.txt', 'hello', { type: 'text/plain' })

  assert.equal(file.contents, 'hello')
  assert.equal(fs.path, '/')
  assert.deepEqual(solid.calls.map(call => [call.kind, call.method, call.url]), [
    ['client', 'get', 'https://pod.example/storage/notes/a.txt'],
    ['client', 'put', 'https://pod.example/storage/notes/b.txt']
  ])
})


test('list recognizes an RDF container even without a trailing slash', async () => {
  const solid = createSolidDouble()
  solid.contains = async () => [{
    id: 'https://pod.example/storage/archive',
    resource: {id: 'https://pod.example/storage/archive', a: ['http://www.w3.org/ns/ldp#Container']}
  }]
  const adapter = new SolidAdapter('https://pod.example/storage/', {solid, metroClient: solid.metro})
  assert.equal((await adapter.list('/'))[0].type, 'folder')
})
