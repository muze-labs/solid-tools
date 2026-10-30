# SimplySolid reference

SimplySolid is the SimplyFlow-facing runtime layer for Solid collections. It creates `app.solid`, exposes collection handles under `app.solid.data.*`, and delegates data loading/saving to Solid Workspace.

It does not authenticate users, parse RDF, expose filesystem operations, discover UI components, generate source code, or implement OIDC itself.

## Exports

```js
import {
  simplySolid,
  SimplySolid,
  SimplySolidCollection
} from '@muze-labs/simplysolid'
```

Default export:

```js
simplySolid
```

## `simplySolid(config)`

```js
const solidService = simplySolid({
  solid: solidClient,
  storage: 'https://pod.example/storage/',
  data: {
    contacts: {
      path: 'contacts/',
      shape: ContactShape
    }
  }
})
```

Config:

- `solid`: a Solid API client. Optional for local-first configurations that can start from local replicas.
- `workspace`: an existing Solid Workspace instance.
- `context`: an OLDM context passed to a newly created workspace. Ignored when `workspace` is supplied.
- `storage`: storage root URL or storage record.
- `localFirst`: enables local-first defaults for resource descriptors.
- `app.id`: stable app identifier. Defaults to the current page URL without the hash when available.
- `app.slug`: URL-safe app storage segment. Defaults from `app.id`.
- `appStorage`: explicit app storage container URL.
- `settings.url`: explicit app settings resource URL.
- `profile`: optional current profile data.
- `sources`: explicit Solid Workspace source descriptors.
- `resources`: explicit Solid Workspace logical resource descriptors.
- `data`: named collection descriptors.

## Collection descriptors

```js
{
  path: 'contacts/',
  shape: ContactShape,
  source: 'contacts',
  sources: ['contacts'],
  createIn: 'contacts',
  local: false,
  remote: {},
  readOnly: false,
  options: {},
  writeOptions: {}
}
```

When `path` is present, SimplySolid resolves it relative to `storage` and creates a Solid Workspace source. Paths ending in `/` become container sources; other paths become resource sources.

When `local`, `localFirst`, or global `localFirst` is used with a resource descriptor, SimplySolid creates a Solid Workspace logical resource. The collection then uses the resource id as both `sources` and `createIn`, so writes commit to the local replica first.

```js
const service = simplySolid({
  localFirst: true,
  app: {
    slug: 'margin-notes'
  },
  data: {
    notes: {
      kind: 'resource',
      local: {
        indexedDB: 'margin-notes',
        key: 'notes'
      },
      shape: NoteShape
    }
  }
})

await service.open()
await service.data.notes.create(note)
```

Local replica options:

- `indexedDB`: database name.
- `indexedDBFactory`: optional IndexedDB implementation for tests.
- `key`: document key inside the local object store.
- `store`: object store name. Defaults to `resources`.
- `id`: local source id. Defaults to `${resourceId}:local`.
- `turtle`: initial Turtle text, defaulting to empty text.
- `prefixes`: prefixes used when exporting Turtle.

After Solid discovery or login, attach a remote replica:

```js
await service.connect({
  solid: solidClient,
  resources: {
    notes: {
      url: notesResourceUrl
    }
  }
})

await service.sync('notes')
```

`connect()` does not perform WebID discovery or OIDC itself. It accepts the already-created Solid API client and the remote resource URLs discovered by the application or another helper.

`shape` is passed to Solid Workspace, which validates through oldm-shape before writes.

## Service API

```js
const service = simplySolid(config)

service.install(app)
await service.open()
service.workspace.context
service.workspace.graph('notes')
await service.sync('notes')
await service.connect({ solid, resources })
await service.checkSetup()
await service.setup()

service.status
service.settings
service.registrations
service.workspace
service.data.contacts
```

`install(app)` assigns `app.solid = service`. If `app.data` exists, it also assigns `app.data.solid = service.status`.

`open()` opens the workspace tolerantly and refreshes collection handles. This is the preferred local-first startup method.

`sync('notes')` reconciles that logical resource's local and remote replicas and
refreshes the collection handles. Use `open()` to reload resources. There is no
sync-as-reload overload or document/dataset facade. Access native OLDM graphs
through `service.workspace.context` and `service.workspace.graph(resourceId)`.


`connect()` sets or replaces the Solid API client, attaches remote replicas for named logical resources, opens them by default, and refreshes collection handles.

`checkSetup()` checks required containers and updates `service.status.setup`.

`setup()` creates missing containers and then checks setup again. It does not repair inaccessible resources and does not write type indexes yet.

Status shape:

```js
{
  state,
  error,
  profile,
  storage,
  setup,
  collections,
  resources,
  lastSync
}
```

Common service states:

- `idle`
- `opening`
- `connecting`
- `syncing`
- `ready`
- `error`

## Setup Conventions

SimplySolid derives small app conventions from `storage`:

```txt
{storage}/apps/{appSlug}/
{storage}/apps/{appSlug}/settings.ttl
```

For example:

```js
const service = simplySolid({
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

This exposes:

```js
service.conventions.appStorage
service.settings.url
service.registrations
service.status.setup
```

`service.registrations` are type-index-style records:

```js
{
  collection,
  forClass,
  instanceContainer,
  instance,
  private,
  registered
}
```

They are inspectable setup metadata. SimplySolid does not silently write a Solid type index.

Setup status shape:

```js
{
  state,
  needed,
  repair,
  checks,
  created,
  error,
  appStorage,
  settingsUrl,
  registrations
}
```

Setup states:

- `unknown`
- `setup-needed`
- `creating`
- `repair-needed`
- `ready`

## Collection Handles

```js
const contacts = app.solid.data.contacts

await contacts.open()
contacts.list()
contacts.get(id)
await contacts.create(data)
await contacts.update(idOrObject, changes)
await contacts.delete(idOrObject)
await contacts.save(idOrObject)
await contacts.saveAll()
```

`create()`, `update()`, and `delete()` save by default. Pass `{ save: false }` to stage locally.

`create()` and `update()` return native nodes owned by the workspace graph.
`save(idOrObject, options)` persists an edited native node and returns the save
status. It rejects failed persistence, retaining the result in `status.lastSave`.
Pass an id to resolve the current node, or use a node returned by this collection.
After reload or replica sync, read nodes again before editing; stale handles are
rejected. Saving a node writes its complete owning resource graph.

Each collection handle exposes:

```js
contacts.items
contacts.status
contacts.collection
```

Collection status shape:

```js
{
  state,
  error,
  lastSync,
  lastSave
}
```

Common collection states:

- `idle`
- `syncing`
- `creating`
- `saving`
- `deleting`
- `ready`
- `error`

## Boundary

SimplySolid owns beginner-facing app service shape and collection handles. Solid Workspace owns source tracking and save semantics. Metro-Solid owns Solid HTTP. Metro-OIDC owns authentication. Metro-OLDM/OLDM own linked-data parsing/writing.
