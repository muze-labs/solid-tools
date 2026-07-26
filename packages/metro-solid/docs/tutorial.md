# Solid API tutorial

This tutorial shows the small Solid API workflow: create a Solid API, discover storage, and work with Solid resources and containers.

## 1. Create a Solid API

`solidApi(base, methods)` follows the same shape as `metro.jsonApi(base, methods)`. Pass a base URL string and optional application methods. Metro-Solid adds `metro-oldm` automatically for linked-data parsing and writing. For applications, this factory is the preferred entry point.

```js
import { solidApi } from '@muze-labs/metro-solid'

const solid = solidApi('https://pod.example/', {
  async notesStorage(webId) {
    const [storage] = await this.discoverStorage(webId)
    return storage?.url
  }
})
```

If you already have a Metro client, for example one configured with authentication middleware, pass that client instead:

```js
const solid = solidApi(authenticatedMetroClient)
```

Solid helpers use the configured client as-is. Generic HTTP operations stay on the Metro API/client.

## 2. Discover the user's storage

```js
const info = await solid.discoverWebId('https://pod.example/profile#me')

const [storageUrl] = info.storage
```

Solid API reads the WebID URL as linked data and returns the requested subject directly. Pass a fully qualified WebID URL; discovery does not resolve relative WebIDs against the API base. Turtle parsing is handled by the automatically installed `metro-oldm` middleware. If the WebID subject is not present in the document, discovery throws.

## 3. Create a container

```js
await solid.createContainer(`${storageUrl}notes/`)
```

This sends a Solid container `Link` header and `If-None-Match: *`, so it does not overwrite an existing container.

## 4. Create and update a resource

```js
await solid.create(`${storageUrl}notes/hello.txt`, 'Hello Solid', {
  headers: { 'Content-Type': 'text/plain' }
})

await solid.put(`${storageUrl}notes/hello.txt`, {
  body: 'Hello again',
  headers: {
    'Content-Type': 'text/plain',
    'If-Match': '"known-etag"'
  }
})
```

Use `solid.create()` for non-overwriting writes. Use `solid.put()` when replacing is intentional.

## 5. Create a contained resource

```js
const created = await solid.postToContainer(`${storageUrl}notes/`, 'Hello', {
  headers: {
    Slug: 'from-post.txt',
    'Content-Type': 'text/plain'
  }
})

console.log(created.location)
console.log(created.etag)
```

`created.response` is the original Metro response.

## 6. Read container membership

```js
const entries = await solid.contains(`${storageUrl}notes/`)

for (const entry of entries) {
  console.log(entry.url)
}
```

`contains()` exposes LDP containment from parsed response data. For filesystem paths, filenames, and folder/file mapping, use `@muze-labs/jsfs-solid`.
