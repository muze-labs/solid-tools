# Basic Metro-Solid resource example

```js
import metro from '@muze-nl/metro'
import oidc from '@muze-nl/metro-oidc'
import { solidApi } from '@muze-labs/metro-solid'

const client = metro.client()
  .with(oidc.oidcmw({
    issuer: 'https://solidcommunity.net',
    client_info: {
      client_name: 'Metro-Solid example'
    }
  }))

const solid = solidApi(client)

await solid.resource('https://example.pod/storage/notes/hello.txt')
  .put('Hello Solid', { headers: { 'Content-Type': 'text/plain' } })
```

Metro-Solid uses the configured Metro client for resource and container calls, so response and error behavior stays with Metro middleware setup.
