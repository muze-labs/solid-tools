# JSFS-Solid

JSFS-Solid is a JSFS adapter for Solid storage. It is implemented on top of [`@muze-labs/lading`](../lading), so Solid resource/container operations live in one lower-level package.

This package is experimental and has no production compatibility promise yet.

## Usage

```js
import solidClient from '@muze-labs/jsfs-solid'

const client = await solidClient('https://example.pod/profile/card#me', {
  client_info: {
    client_name: 'My App'
  }
})

const storage = client.storage[0]
const entries = await storage.list('/')
const file = await storage.read('contacts.ttl')
```

The returned client contains:

- `webId`
- `profile`
- `issuer`
- `inbox`
- `storage`: one JSFS filesystem per storage root
- `metro`: the configured Metro client
- `solid`: the Lading client

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
