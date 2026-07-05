# JSFS-Solid tutorial

This tutorial shows the small JSFS-Solid workflow: configure Metro, create a filesystem, and use filesystem-shaped operations over Solid storage.

## 1. Configure Metro and Lading

Application code owns authentication and linked-data middleware setup.

```js
import metro from '@muze-nl/metro'
import oidc from '@muze-nl/metro-oidc'
import oldmmw from '@muze-nl/metro-oldm'
import { lading } from '@muze-labs/lading'
import { solidFs } from '@muze-labs/jsfs-solid'

const client = metro.client('https://pod.example/storage/')
  .with(oidc.oidcmw({
    issuer: 'https://issuer.example/',
    client_info: {
      client_name: 'My App'
    }
  }))
  .with(oldmmw())

const solid = lading(client)
```

## 2. Create a filesystem

```js
const fs = solidFs('https://pod.example/storage/', {
  metroClient: client,
  solid
})
```

Passing an existing Metro client keeps setup explicit. JSFS-Solid will not add middleware again unless `configureMetro: true` is set.

## 3. Write and read files

```js
await fs.write('/notes/hello.txt', 'Hello Solid', {
  type: 'text/plain'
})

const note = await fs.read('/notes/hello.txt')

console.log(note.name)
console.log(note.contents)
console.log(note.http.status)
```

`write()` maps JSFS metadata to Lading write options. `read()` returns a file-shaped object with the original HTTP response details under `http`.

## 4. Work with folders

```js
await fs.mkdir('/notes/archive/')

const entries = await fs.list('/notes/')

for (const entry of entries) {
  console.log(entry.type, entry.path)
}

await fs.rmdir('/notes/archive/')
```

Folders are Solid containers. Listing uses Lading's LDP containment API and maps contained resources to JSFS entries.

## 5. Remove files

```js
await fs.remove('/notes/hello.txt')
```

`remove()` delegates to Lading resource deletion.

## 6. Use the adapter directly

Use `SolidAdapter` directly when a caller wants the adapter object instead of a JSFS `FileSystem` wrapper.

```js
import { SolidAdapter } from '@muze-labs/jsfs-solid'

const adapter = new SolidAdapter('https://pod.example/storage/', {
  metroClient: client,
  solid
})

const url = adapter.url('/notes/hello.txt')
```

The adapter owns filesystem-shaped mapping only. Solid HTTP stays in Lading, authentication stays in Metro-OIDC, and linked-data parsing stays in Metro-OLDM/OLDM.

