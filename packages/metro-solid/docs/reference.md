# Solid API reference

Solid API is a Metro API helper for Solid storage. It owns Solid container conveniences, headers, automatic `metro-oldm` linked-data parsing/writing, profile discovery, storage discovery, and safe create operations.

It does not authenticate, map OLDM objects, expose a filesystem API, or define app setup conventions.

## Creating a client

```js
import metro from '@muze-nl/metro'
import { SolidAPI, solidApi } from '@muze-labs/metro-solid'

const solid = solidApi('https://pod.example/', {
  async profile(webId) {
    return this.discoverWebId(webId)
  }
})

const authenticated = solidApi(metro.client('https://pod.example/').with(authMiddleware))
```

`SolidAPI` extends `metro.API`. `solidApi(base, methods)` is the factory function and returns a `SolidAPI` instance. `base` may be a URL string, a URL object, Metro client options, or an existing Metro client.

`methods` is optional. Like `metro.jsonApi()`, functions in `methods` are bound to the API object, so use normal function syntax when you need `this.get()`, `this.discoverWebId()`, or another API method.

Metro-Solid adds `metro-oldm` automatically. If the provided client already has an `oldmmw` middleware, it is reused rather than added twice.

## Solid API methods

```js
await solid.create(url, body, options)
await solid.createContainer(url, options)
await solid.postToContainer(url, body, options)
await solid.contains(url, options)
await solid.discoverProfile(webId)
await solid.discoverStorage(webId)
await solid.discoverWebId(webId)
```

The returned object also has Metro API methods such as `get()`, `post()`, `put()`, `patch()`, `delete()`, `head()`, and `extend()`. Those keep Metro's normal API semantics.

General linked-data reads return the parsed OLDM result. That result may be a graph or a collection of subjects and does not need to have a primary subject.

`discoverProfile(webId)` is stricter because a WebID identifies one subject. `webId` must be a fully qualified URL. The method reads the WebID resource and returns that profile subject directly. It throws when the URL is invalid or the requested WebID subject is not present.

`discoverStorage(webId)` returns storage records:

```js
[{ id, url, profile }]
```

Storage discovery expects the `pims` prefix from the default `metro-oldm` context, so parsed profile data should expose `pims$storage`.

`discoverWebId(webId)` returns:

```js
{ webId, profile, storage, issuer, inbox }
```

## Safe Resource Creation

```js
await solid.create('notes/hello.txt', body, options)
```

`create()` is a safe write helper over `PUT`. It sends `If-None-Match: *` unless `options.headers` already includes `If-None-Match`.

Common options:

- `headers`

## `SolidContainer`

```js
await solid.createContainer('notes', options)
await solid.postToContainer('notes', body, options)
await solid.contains('notes', options)
```

Container URLs are normalized to a trailing slash.

`createContainer()` sends an LDP BasicContainer `Link` header and uses `If-None-Match: *` by default.

`postToContainer(body, options)` creates a contained resource and returns:

```js
{ response, location, etag }
```

`contains()` reads `response.data.primary.ldp$contains` and returns:

```js
[{ id, url, resource, response }]
```

Use `@muze-labs/jsfs-solid` for filesystem-shaped listing. Solid API exposes the lower-level LDP containment primitive.

## Headers

Pass HTTP headers using their standard names in `options.headers`, for example `{ 'Content-Type': 'text/turtle', 'If-Match': etag }`. Generic request and response behavior remains Metro's job.
