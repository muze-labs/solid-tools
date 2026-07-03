# JSFS-Solid browser example

```html
<script type="module">
  import solidClient from '@muze-labs/jsfs-solid'

  const client = await solidClient('https://example.pod/profile/card#me', {
    client_info: {
      client_name: 'JSFS-Solid example'
    }
  })

  const entries = await client.storage[0].list('/')
  console.log(entries)
</script>
```
