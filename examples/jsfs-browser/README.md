# JSFS-Solid browser example

```html
<script type="module">
  import metro from '@muze-nl/metro'
  import oidc from '@muze-nl/metro-oidc'
  import oldmmw from '@muze-nl/metro-oldm'
  import { solidApi } from '@muze-labs/metro-solid'
  import { solidFs } from '@muze-labs/jsfs-solid'

  const client = metro.client('https://example.pod/storage/')
    .with(oidc.oidcmw({
      issuer: 'https://issuer.example/',
      client_info: {
        client_name: 'JSFS-Solid example'
      }
    }))
    .with(oldmmw())

  const solid = solidApi(client)
  const fs = solidFs('https://example.pod/storage/', { client, solid })

  const entries = await fs.list('/')
  console.log(entries)
</script>
```
