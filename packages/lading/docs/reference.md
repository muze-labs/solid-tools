# Lading reference

Lading is a Solid-shaped layer over an already configured Metro client. It owns Solid resources, containers, headers, profile discovery, storage discovery, and safe reads/writes.

It does not authenticate, parse RDF, map OLDM objects, expose a filesystem API, or define app setup conventions.

## Creating a client

```js
import metro from '@muze-nl/metro'
import { lading } from '@muze-labs/lading'

const client = metro.client('https://pod.example/')
const solid = lading(client)
```

`lading(client, options)` returns a `LadingClient`.

Options:

- `thrower`: defaults to Metro's `mw.thrower()` when available and the client supports `.with()`.
- `thrower: false`: leaves non-OK responses for the caller.
- `thrower: fn`: uses a supplied Metro middleware factory.

## `LadingClient`

```js
solid.resource(url)
solid.container(url)
await solid.discoverProfile(webId)
await solid.discoverStorage(webId)
await solid.discoverWebId(webId)
solid.storageFromProfile(profile)
```

`discoverProfile(webId)` reads the WebID resource and returns `{ response, profile }`. The `profile` value is `response.data.primary`, so it only exists when a caller configured Metro with linked-data parsing such as `metro-oldm`.

`discoverStorage(webId)` returns storage records:

```js
[{ id, url, profile, response }]
```

`discoverWebId(webId)` returns:

```js
{ webId, profile, storage, issuer, inbox, response }
```

## `SolidResource`

```js
const resource = solid.resource('notes/hello.txt')

await resource.get(options)
await resource.head(options)
await resource.put(body, options)
await resource.create(body, options)
await resource.patch(body, options)
await resource.delete(options)
```

`create()` is a safe write helper. It sends `If-None-Match: *` unless `options.ifNoneMatch` is provided.

Common options:

- `accept`
- `contentType` or `type`
- `ifMatch`
- `ifNoneMatch`
- `etag`, used as `If-Match` when `ifMatch` is absent
- `headers`

## `SolidContainer`

```js
const container = solid.container('notes')

await container.get(options)
await container.create(options)
await container.post(body, options)
await container.contains(options)
```

Container URLs are normalized to a trailing slash.

`create()` sends an LDP BasicContainer `Link` header and uses `If-None-Match: *` by default.

`post(body, options)` creates a contained resource and returns:

```js
{ response, location, etag }
```

`contains()` reads `response.data.primary.ldp$contains` and returns:

```js
[{ id, url, resource, response }]
```

Use `@muze-labs/jsfs-solid` for filesystem-shaped listing. Lading exposes the lower-level LDP containment primitive.

## Header helpers

```js
solidRequestHeaders(options)
containerHeaders(options)
containerLinkHeader(type)
getHeader(headers, name)
getLocation(response)
getETag(response)
parseLinkHeader(value)
linksByRel(responseOrHeaders, rel)
```

These helpers cover Solid-specific header conveniences. Generic request and response behavior remains Metro's job.

