# Solid Tools

Solid Tools is a Muze Labs monorepo for small, composable Solid access libraries.

It currently contains:

- [`@muze-labs/lading`](./packages/lading): a thin Solid resource/container layer over Metro.
- [`@muze-labs/jsfs-solid`](./packages/jsfs-solid): a JSFS adapter backed by Solid, implemented on top of Lading.

The repository is intentionally lower-level than SimplySolid. It contains Solid access infrastructure, not application conventions.

```txt
metro
  generic HTTP

metro-oidc
  authentication/session middleware

lading
  Solid-aware resource and container operations

jsfs-solid
  JSFS adapter implemented on top of lading
```

This version targets the current Metro monorepo shape, starting with `@muze-nl/metro` 0.7.x:

```js
import metro from '@muze-nl/metro'
import { lading } from '@muze-labs/lading'

const client = metro.client('https://pod.example/')
const solid = lading(client)

await solid.resource('notes/a.txt').put('Hello', { contentType: 'text/plain' })
```

Lading reuses Metro's direct verb methods and `metro.mw.thrower()` middleware instead of defining its own request or error abstraction.

## Package boundaries

See [docs/package-boundaries.md](./docs/package-boundaries.md).

## Development

```bash
npm install
npm test
```

The packages are experimental and are published under the `@muze-labs` namespace.
