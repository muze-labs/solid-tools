# Lading

Lading is the Solid-shaped Metro layer.

It handles Solid resource and container operations, header helpers, safe write options, and minimal Solid discovery over an already-configured Metro client.

It does **not** handle authentication, RDF parsing, file-system APIs, OLDM object modelling, or application conventions.

```js
import metro from '@muze-nl/metro'
import { lading } from '@muze-labs/lading'

const client = metro.client('https://pod.example/').with(/* metro-oidc, metro-oldm, etc. */)
const solid = lading(client)

await solid.resource('notes/hello.txt').get()
await solid.resource('notes/hello.txt').put('Hello', { contentType: 'text/plain' })
await solid.resource('notes/new.txt').create('Hello', { contentType: 'text/plain' })
await solid.container('notes/').create()

const created = await solid.container('notes/').post('Hello', {
  slug: 'hello.txt',
  contentType: 'text/plain'
})

console.log(created.location)
```

`resource.create(body, options)` and `container.create(options)` send `If-None-Match: *` by default so callers can create without overwriting an existing resource. Use direct `put()` when replacement is intentional.

## Metro style

Lading follows the current Metro style:

- it calls `client.get()`, `client.post()`, `client.put()`, and the other direct verb methods;
- it uses Metro's existing `thrower()` middleware for non-OK HTTP responses;
- it does not define its own HTTP error type.

By default, `lading(client)` wraps clients that support `.with()` with `metro.mw.thrower()`. Pass `{ thrower: false }` to leave the client unchanged:

```js
const solid = lading(client, { thrower: false })
```

Metro thrower errors keep the response in `error.cause`, so callers can still branch on status when needed:

```js
try {
  await solid.resource(url).get()
} catch (error) {
  if (error.cause?.status === 404) {
    // missing resource
  }
}
```

Pass `{ thrower: false }` when a caller needs to receive non-OK responses directly, for example during OIDC login or authorization flows that branch on `401` or `403`.

Creation helpers keep the normal Metro/fetch-shaped response. `container.post()` additionally exposes Solid creation headers:

```js
const created = await solid.container(url).post(body, { slug: 'note.ttl' })

created.response.status // HTTP status from Metro
created.location        // Location response header
created.etag            // ETag response header
```

## Discovery

Lading can consume linked-data already parsed by `metro-oldm`:

```js
const info = await solid.discoverWebId(webId)

info.storage // storage root URLs
info.issuer  // Solid OIDC issuer URL, if present
info.inbox   // LDP inbox URL, if present
```

If a caller already has parsed profile data, the same storage normalization is available without another HTTP request:

```js
import { storageUrlsFromProfile } from '@muze-labs/lading'

const storage = storageUrlsFromProfile(profile)
```

Lading does not parse Turtle or JSON-LD itself. If the Metro client does not use a linked-data middleware, discovery returns no profile data.

Container membership also consumes parsed linked data from the response:

```js
const entries = await solid.container(storageUrl).contains()

entries[0].url      // contained resource URL
entries[0].resource // parsed ldp:contains item
```

## Headers

```js
import { solidRequestHeaders, parseLinkHeader } from '@muze-labs/lading'

solidRequestHeaders({
  contentType: 'text/turtle',
  slug: 'note.ttl',
  ifMatch: '"abc"'
})
```

## Boundary

```txt
metro
  generic HTTP

metro-oidc
  authentication/session middleware

metro-oldm / OLDM
  linked-data parsing and writing

lading
  Solid resource/container affordances
```
