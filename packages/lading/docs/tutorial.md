# Lading tutorial

This tutorial shows the small Lading workflow: configure Metro, wrap it with Lading, discover storage, and work with Solid resources and containers.

## 1. Configure Metro

Lading assumes Metro is already configured. Add authentication or linked-data middleware outside Lading.

```js
import metro from '@muze-nl/metro'
import oldmmw from '@muze-nl/metro-oldm'
import { lading } from '@muze-labs/lading'

const client = metro
  .client('https://pod.example/')
  .with(oldmmw())

const solid = lading(client)
```

If a caller needs to handle `401` or `403` responses directly, disable the default thrower:

```js
const solid = lading(client, { thrower: false })
```

## 2. Discover the user's storage

```js
const info = await solid.discoverWebId('https://pod.example/profile#me')

const [storageUrl] = info.storage
```

Lading reads parsed profile data from `response.data.primary`. It does not parse Turtle or JSON-LD itself.

## 3. Create a container

```js
await solid.container(`${storageUrl}notes/`).create()
```

This sends a Solid container `Link` header and `If-None-Match: *`, so it does not overwrite an existing container.

## 4. Create and update a resource

```js
const note = solid.resource(`${storageUrl}notes/hello.txt`)

await note.create('Hello Solid', {
  contentType: 'text/plain'
})

await note.put('Hello again', {
  contentType: 'text/plain',
  ifMatch: '"known-etag"'
})
```

Use `create()` for non-overwriting writes. Use `put()` when replacing is intentional.

## 5. Create a contained resource

```js
const created = await solid.container(`${storageUrl}notes/`).post('Hello', {
  slug: 'from-post.txt',
  contentType: 'text/plain'
})

console.log(created.location)
console.log(created.etag)
```

`created.response` is the original Metro response.

## 6. Read container membership

```js
const entries = await solid.container(`${storageUrl}notes/`).contains()

for (const entry of entries) {
  console.log(entry.url)
}
```

`contains()` exposes LDP containment from parsed response data. For filesystem paths, filenames, and folder/file mapping, use `@muze-labs/jsfs-solid`.

