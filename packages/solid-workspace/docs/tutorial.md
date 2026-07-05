# Solid Workspace tutorial

This tutorial shows the small Solid Workspace flow: define sources, load OLDMed data, use a collection, and save changes.

## 1. Configure Lading

Solid Workspace expects a Lading client. Authentication and linked-data parsing stay in Metro middleware.

```js
import metro from '@muze-nl/metro'
import oldmmw from '@muze-nl/metro-oldm'
import { lading } from '@muze-labs/lading'

const client = metro.client('https://pod.example/')
  .with(oldmmw())

const solidClient = lading(client)
```

## 2. Define a shape

```js
import { field, shape } from '@muze-labs/oldm-shape'

const ContactShape = shape({
  class: 'schema$Person',
  fields: {
    schema$name: field.string({ min: 1, max: 1 }),
    schema$email: field.string({ many: true, default: () => [] })
  }
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

Container sources are listed with Lading's `contains()` helper. Each contained resource is then loaded through Lading and parsed by Metro-OLDM.

## 5. Create and save

```js
const ada = await ws.collections.contacts.create({
  rdf$type: 'schema$Person',
  schema$name: 'Ada Lovelace'
})

await ws.collections.contacts.save(ada)
```

`create()` applies shape defaults and validates the object. Saving a new object to a container uses Lading's container `post()`.

## 6. Update and delete

```js
ada.schema$email = ['ada@example.test']

const saved = await ws.collections.contacts.save(ada)
console.log(saved.status)

const removed = await ws.collections.contacts.delete(ada)
console.log(removed.status)
```

`save()` and `delete()` return per-resource status objects. `saveAll()` throws when any save fails and includes `error.statuses` plus `error.failures`.
