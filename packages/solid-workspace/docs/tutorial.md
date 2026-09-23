# Solid Workspace tutorial

This tutorial shows the small Solid Workspace flow: define sources, load OLDMed data, use a collection, and save changes.

## 1. Configure Solid API

Solid Workspace expects a Solid API client. Authentication and linked-data parsing stay in Metro middleware.

```js
import metro from '@muze-nl/metro'
import oldmmw from '@muze-nl/metro-oldm'
import { solidApi } from '@muze-labs/metro-solid'

const client = metro.client('https://pod.example/')
  .with(oldmmw())

const solidClient = solidApi(client)
```

## 2. Define a shape

```js
import { field, shape } from '@muze-labs/oldm-shape'
import { Optional } from '@muze-nl/assert'

const ContactShape = shape('https://schema.org/Person', {
  schema$name: field('schema$name', String),
  schema$email: Optional(field('schema$email', [String]))
})
```

## 3. Create a workspace

```js
import { collection, solid, workspace } from '@muze-labs/solid-workspace'

const ws = workspace({
  solid: solidClient,
  sources: [
    solid.container('https://pod.example/contacts/', { id: 'contacts' })
  ],
  collections: {
    contacts: collection({
      shape: ContactShape,
      sources: ['contacts'],
      createIn: 'contacts'
    })
  }
})
```

## 4. Load and list data

```js
await ws.load()

for (const contact of ws.collections.contacts.list()) {
  console.log(contact.schema$name)
}
```

Container sources are listed with the Solid API `contains()` helper. Each contained resource is then loaded through Solid API and parsed by Metro-OLDM.

## 5. Create and save

```js
const ada = await ws.collections.contacts.create({
  a: 'https://schema.org/Person',
  schema$name: 'Ada Lovelace'
})

await ws.collections.contacts.save(ada)
```

`create()` applies shape defaults and validates the object. Saving a new object to a container uses the Solid API container `post()`.

## 6. Update and delete

```js
ada.schema$email = ['ada@example.test']

const saved = await ws.collections.contacts.save(ada)
console.log(saved.status)

const removed = await ws.collections.contacts.delete(ada)
console.log(removed.status)
```

`save()` and `delete()` return per-resource status objects. `saveAll()` throws when any save fails and includes `error.statuses` plus `error.failures`.
