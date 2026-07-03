import assert from 'node:assert/strict'
import test from 'node:test'
import {
  containerHeaders,
  getLocation,
  linksByRel,
  parseLinkHeader,
  solidRequestHeaders
} from '../src/index.mjs'

test('solidRequestHeaders maps common Solid write options to headers', () => {
  assert.deepEqual(solidRequestHeaders({
    contentType: 'text/turtle',
    accept: 'text/turtle',
    slug: 'note.ttl',
    ifMatch: '"abc"'
  }), {
    Accept: 'text/turtle',
    'Content-Type': 'text/turtle',
    Slug: 'note.ttl',
    'If-Match': '"abc"'
  })
})

test('containerHeaders adds an LDP BasicContainer Link header', () => {
  assert.equal(
    containerHeaders().Link,
    '<http://www.w3.org/ns/ldp#BasicContainer>; rel="type"'
  )
})

test('parseLinkHeader parses multiple links', () => {
  const links = parseLinkHeader('<http://www.w3.org/ns/ldp#Resource>; rel="type", <acl>; rel="acl"')
  assert.deepEqual(links, [
    { href: 'http://www.w3.org/ns/ldp#Resource', rel: 'type' },
    { href: 'acl', rel: 'acl' }
  ])
})

test('linksByRel filters parsed Link headers', () => {
  const headers = {
    Link: '<http://www.w3.org/ns/ldp#Resource>; rel="type", <acl>; rel="acl"'
  }
  assert.deepEqual(linksByRel(headers, 'acl'), [{ href: 'acl', rel: 'acl' }])
})

test('getLocation reads case-insensitive headers', () => {
  assert.equal(getLocation({ headers: { location: '/created' } }), '/created')
})
