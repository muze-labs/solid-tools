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
    resource(url) {
      return {
        async get(options) {
          calls.push({ kind: 'resource', method: 'get', url, options })
          return response('hello', {
            url,
            headers: { 'Content-Type': 'text/plain' }
          })
        },
        async put(body, options) {
          calls.push({ kind: 'resource', method: 'put', url, body, options })
          return response('', {
            status: 201,
            url,
            headers: { ETag: '"write"' }
          })
        },
        async delete(options) {
          calls.push({ kind: 'resource', method: 'delete', url, options })
          return response('', { status: 205, url })
        }
      }
    },
    container(url) {
      const containerUrl = ensureSlash(url)
      return {
        async contains(options) {
          calls.push({ kind: 'container', method: 'contains', url: containerUrl, options })
          return [
            {
              id: 'https://pod.example/storage/notes/a.txt',
              resource: { id: 'https://pod.example/storage/notes/a.txt' }
            },
            {
              id: 'https://pod.example/storage/notes/archive/',
              resource: {
                id: 'https://pod.example/storage/notes/archive/',
                a: ['ldp$Container']
              }
            }
          ]
        },
        async create(options) {
          calls.push({ kind: 'container', method: 'create', url: containerUrl, options })
          return response('', { status: 201, url: containerUrl })
        },
        async delete(options) {
          calls.push({ kind: 'container', method: 'delete', url: containerUrl, options })
          return response('', { status: 205, url: containerUrl })
        }
      }
    }
  }
}

test('read resolves paths and returns file-shaped text content', async () => {
  const solid = createSolidDouble()
  const adapter = new SolidAdapter('https://pod.example/storage/', {
    solid,
    metroClient: metro.client('https://pod.example/storage/')
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
    kind: 'resource',
    method: 'get',
    url: 'https://pod.example/storage/notes/a.txt',
    options: undefined
  }])
})

test('write delegates resource writes to Lading with JSFS metadata', async () => {
  const solid = createSolidDouble()
  const adapter = new SolidAdapter('https://pod.example/storage/', {
    solid,
    metroClient: metro.client('https://pod.example/storage/')
  })

  const written = await adapter.write('/notes/a.txt', 'hello', {
    type: 'text/plain',
    ifMatch: '"old"',
    headers: { 'X-Test': 'yes' }
  })

  assert.equal(written.name, 'a.txt')
  assert.equal(written.type, 'text/plain')
  assert.equal(written.http.status, 201)
  assert.deepEqual(solid.calls, [{
    kind: 'resource',
    method: 'put',
    url: 'https://pod.example/storage/notes/a.txt',
    body: 'hello',
    options: {
      contentType: 'text/plain',
      ifMatch: '"old"',
      ifNoneMatch: undefined,
      headers: { 'X-Test': 'yes' }
    }
  }])
})

test('list maps LDP containment to JSFS entries', async () => {
  const solid = createSolidDouble()
  const adapter = new SolidAdapter('https://pod.example/storage/', {
    solid,
    metroClient: metro.client('https://pod.example/storage/')
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
        a: ['ldp$Container']
      }
    }
  ])

  assert.deepEqual(solid.calls, [{
    kind: 'container',
    method: 'contains',
    url: 'https://pod.example/storage/notes/',
    options: undefined
  }])
})

test('mkdir, rmdir, and remove delegate to Lading container/resource operations', async () => {
  const solid = createSolidDouble()
  const adapter = new SolidAdapter('https://pod.example/storage/', {
    solid,
    metroClient: metro.client('https://pod.example/storage/')
  })

  await adapter.mkdir('/notes/archive')
  await adapter.rmdir('/notes/archive')
  await adapter.remove('/notes/a.txt')

  assert.deepEqual(solid.calls, [
    {
      kind: 'container',
      method: 'create',
      url: 'https://pod.example/storage/notes/archive/',
      options: undefined
    },
    {
      kind: 'container',
      method: 'delete',
      url: 'https://pod.example/storage/notes/archive/',
      options: undefined
    },
    {
      kind: 'resource',
      method: 'delete',
      url: 'https://pod.example/storage/notes/a.txt',
      options: undefined
    }
  ])
})

test('solidFs returns a JSFS filesystem wrapper around SolidAdapter', async () => {
  const solid = createSolidDouble()
  const fs = solidFs('https://pod.example/storage/', {
    solid,
    metroClient: metro.client('https://pod.example/storage/')
  })

  const file = await fs.read('/notes/a.txt')
  await fs.write('/notes/b.txt', 'hello', { type: 'text/plain' })

  assert.equal(file.contents, 'hello')
  assert.equal(fs.path, '/')
  assert.deepEqual(solid.calls.map(call => [call.kind, call.method, call.url]), [
    ['resource', 'get', 'https://pod.example/storage/notes/a.txt'],
    ['resource', 'put', 'https://pod.example/storage/notes/b.txt']
  ])
})
