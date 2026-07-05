# JSFS-Solid

JSFS-Solid is a JSFS adapter for Solid storage. It is implemented on top of [`@muze-labs/lading`](../lading), so Solid resource/container operations live in one lower-level package.

This package is experimental and has no production compatibility promise yet.

## Usage

```js
import metro from '@muze-nl/metro'
import oidc from '@muze-nl/metro-oidc'
import oldmmw from '@muze-nl/metro-oldm'
import { lading } from '@muze-labs/lading'
import { solidFs } from '@muze-labs/jsfs-solid'

const client = metro.client('https://example.pod/storage/')
  .with(oidc.oidcmw({
    issuer: 'https://issuer.example/',
    client_info: {
      client_name: 'My App'
    }
  }))
  .with(oldmmw())

const solid = lading(client)
const fs = solidFs('https://example.pod/storage/', { client, solid })

await fs.write('/notes/hello.txt', 'Hello', { type: 'text/plain' })
const note = await fs.read('/notes/hello.txt')
```

`jsfs-solid` no longer exports a higher-level `solidClient`. Application code composes Metro, Metro-OIDC, Lading, and JSFS-Solid directly. A later SimplySolid package can provide application-level setup and discovery conventions.

## Adapter

```js
import { SolidAdapter } from '@muze-labs/jsfs-solid'

const adapter = new SolidAdapter('https://example.pod/storage/', {
  client_info: {
    client_name: 'My App'
  }
})

await adapter.write('/notes/hello.txt', 'Hello', { type: 'text/plain' })
const note = await adapter.read('/notes/hello.txt')
```

## Passing an existing Metro client

```js
import metro from '@muze-nl/metro'
import { SolidAdapter } from '@muze-labs/jsfs-solid'

const client = metro.client('https://example.pod/storage/')
const adapter = new SolidAdapter('https://example.pod/storage/', {
  metroClient: client
})
```

A provided Metro client is treated as already configured. Pass `configureMetro: true` to add JSFS-Solid's default `metro-oidc` and `metro-oldm` middleware stack.

## Package boundary

JSFS-Solid owns file-system-shaped operations:

- `read`
- `write`
- `list`
- `mkdir`
- `rmdir`
- `remove`

Lading owns the Solid HTTP/resource/container operations underneath.

Authentication remains in `metro-oidc`. Linked-data parsing remains in `metro-oldm` and `oldm`.
