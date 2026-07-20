# SimplySolid tutorial

This tutorial shows a small contacts collection exposed through `app.solid`.

## 1. Configure Metro and Lading

Authentication and linked-data parsing stay in Metro middleware.

```js
import metro from '@muze-nl/metro'
import oidc from '@muze-nl/metro-oidc'
import oldmmw from '@muze-nl/metro-oldm'
import { lading } from '@muze-labs/lading'

const client = metro.client('https://pod.example/storage/')
  .with(oidc.oidcmw({
    issuer: 'https://issuer.example/',
    client_info: {
      client_name: 'Contacts'
    }
  }))
  .with(oldmmw())

const solidClient = lading(client)
```

## 2. Define a collection shape

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

## 3. Create the Solid service

```js
import { simplySolid } from '@muze-labs/simplysolid'

const solidService = simplySolid({
  solid: solidClient,
  storage: 'https://pod.example/storage/',
  app: {
    id: 'https://apps.example/contacts/',
    slug: 'contacts'
  },
  data: {
    contacts: {
      path: 'contacts/',
      shape: ContactShape
    }
  }
})
```

The `contacts/` path is resolved relative to the storage root and becomes a Solid container source. The app settings container defaults to `apps/contacts/`, with settings at `apps/contacts/settings.ttl`.

## 4. Check setup

```js
const setup = await solidService.checkSetup()

if (setup.state === 'setup-needed') {
  await solidService.setup()
}
```

`setup()` creates missing containers. If a resource exists but cannot be accessed, setup status becomes `repair-needed` so the app can show its own UI or guidance.

## 5. Install it on a SimplyFlow app

```js
import { app } from '@muze-labs/simplyflow'

const contactsApp = app({
  data: {
    contacts: []
  },
  solid: solidService,
  async start() {
    this.solid.install(this)
    await this.solid.setup()
    await this.solid.sync()
    this.data.contacts = this.solid.data.contacts.items
  },
  commands: {
    async addContact() {
      await this.solid.data.contacts.create({
        rdf$type: 'schema$Person',
        schema$name: 'New contact'
      })
      this.data.contacts = this.solid.data.contacts.items
    }
  }
})
```

HTML can bind to normal SimplyFlow data:

```html
<ul data-simply-list="contacts">
  <template>
    <li>
      <span data-simply-field="schema$name"></span>
    </li>
  </template>
</ul>

<button data-simply-command="addContact">Add</button>
```

Setup status is also exposed through `app.data.solid.setup` for normal SimplyFlow rendering.

## 6. Read and write through handles

```js
await contactsApp.solid.data.contacts.sync()

const contacts = contactsApp.solid.data.contacts.list()
const ada = contactsApp.solid.data.contacts.get('https://pod.example/storage/contacts/ada.ttl#me')

await contactsApp.solid.data.contacts.update(ada, {
  schema$email: ['ada@example.test']
})

await contactsApp.solid.data.contacts.delete(ada)
```

`create()`, `update()`, and `delete()` save by default. Pass `{ save: false }` to stage changes locally and call `saveAll()` later.
