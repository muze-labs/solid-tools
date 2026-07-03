# Basic Lading resource example

```js
import metro from '@muze-nl/metro'
import oidc from '@muze-nl/metro-oidc'
import { lading } from '@muze-labs/lading'

const client = metro.client()
  .with(oidc.oidcmw({
    issuer: 'https://solidcommunity.net',
    client_info: {
      client_name: 'Lading example'
    }
  }))

const solid = lading(client)

await solid.resource('https://example.pod/storage/notes/hello.txt')
  .put('Hello Solid', { contentType: 'text/plain' })
```

Lading uses Metro's direct verb methods internally and adds Metro's `thrower()` middleware by default, so non-OK HTTP responses behave like normal Metro thrower errors.
