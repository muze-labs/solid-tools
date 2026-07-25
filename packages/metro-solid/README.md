# Solid API

Solid API is a Metro API helper for Solid resources and containers.

Milestone status: Milestone 1 core is implemented.

It handles Solid resource and container operations, header helpers, safe write options, linked-data parsing through `metro-oldm`, and minimal Solid discovery. `solidApi(base, methods)` returns a `SolidAPI` object, where `base` can be a URL string or an existing Metro client.

It does **not** handle authentication, file-system APIs, OLDM object modelling, or application conventions.

Docs:

- [Tutorial](docs/tutorial.md)
- [Reference](docs/reference.md)

```js
import { solidApi } from '@muze-labs/metro-solid'

const solid = solidApi('https://pod.example/', {
  async storageFor(webId) {
    return this.discoverStorage(webId)
  }
})

await solid.get('notes/hello.txt')
await solid.put('notes/hello.txt', {
  body: 'Hello',
  headers: { 'Content-Type': 'text/plain' }
})
await solid.create('notes/new.txt', 'Hello', { headers: { 'Content-Type': 'text/plain' } })
await solid.createContainer('notes/')

const created = await solid.postToContainer('notes/', 'Hello', {
  headers: {
    Slug: 'hello.txt',
    'Content-Type': 'text/plain'
  }
})

console.log(created.location)
```

`create(url, body, options)` and `createContainer(url, options)` send `If-None-Match: *` by default so callers can create without overwriting an existing resource. Use `put()` when replacement is intentional.

## Metro style

Solid API follows the current Metro style:

- `SolidAPI` extends `metro.API`;
- `solidApi()` is the factory function, like `metro.jsonApi()`;
- it accepts the same base URL plus methods style as `metro.jsonApi()`;
- it adds `metro-oldm` automatically, unless the provided client already has it;
- generic HTTP methods remain Metro API/client behavior;
- its Solid-specific helpers call the API object's own Metro verb methods;
- it does not define its own HTTP error type.

General linked-data reads return the parsed OLDM result. That result may be a graph or a collection of subjects and does not need to have a primary subject. Profile discovery is stricter: a WebID identifies one subject and must be a fully qualified URL, so `discoverProfile(webId)` returns that subject directly or throws.
Add authentication middleware to the base Metro client when requests should authenticate.

Creation helpers keep the normal Metro/fetch-shaped response. `postToContainer()` additionally exposes Solid creation headers:

```js
const created = await solid.postToContainer(url, body, { headers: { Slug: 'note.ttl' } })

created.response.status // HTTP status from Metro
created.location        // Location response header
created.etag            // ETag response header
```

## Discovery

Solid API consumes linked data parsed by the `metro-oldm` middleware it installs:

```js
const profile = await solid.discoverProfile(webId)
const info = await solid.discoverWebId(webId)

profile.id    // the WebID subject
info.storage // storage root URLs
info.issuer  // Solid OIDC issuer URL, if present
info.inbox   // LDP inbox URL, if present
```

Use the parsed profile subject directly when you need profile-specific predicates that are not exposed by `discoverWebId()`.

Storage discovery expects the `pims` prefix used by the default `metro-oldm` context, so profile data should expose `pims$storage`.

Solid API does not parse Turtle itself; it delegates that to `metro-oldm`.

Container membership also consumes parsed linked data from the response:

```js
const entries = await solid.contains(storageUrl)

entries[0].url      // contained resource URL
entries[0].resource // parsed ldp:contains item
```

## Boundary

```txt
metro
  generic HTTP

metro-oidc
  authentication/session middleware

metro-oldm / OLDM
  linked-data parsing and writing

solidApi
  Solid HTTP affordances
```
