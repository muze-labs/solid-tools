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
  solid: ladingClient,
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

- `solid`, `lading`, or `client`: a Lading client.
- `workspace`: an existing Solid Workspace instance.
- `storage`: storage root URL or storage record.
- `profile`: optional current profile data.
- `sources`: explicit Solid Workspace source descriptors.
- `data` or `collections`: named collection descriptors.

## Collection descriptors

```js
{
  path: 'contacts/',
  shape: ContactShape,
  source: 'contacts',
  sources: ['contacts'],
  createIn: 'contacts',
  readOnly: false,
  options: {},
  writeOptions: {}
}
```

When `path` is present, SimplySolid resolves it relative to `storage` and creates a Solid Workspace source. Paths ending in `/` become container sources; other paths become resource sources.

`shape` is passed to Solid Workspace, which validates through oldm-shape before writes.

## Service API

```js
const service = simplySolid(config)

service.install(app)
await service.sync()

service.status
service.workspace
service.data.contacts
```

`install(app)` assigns `app.solid = service`. If `app.data` exists, it also assigns `app.data.solid = service.status`.

`sync()` loads all workspace sources and refreshes collection handles.

Status shape:

```js
{
  state,
  error,
  profile,
  storage,
  collections,
  lastSync
}
```

Common service states:

- `idle`
- `syncing`
- `ready`
- `error`

## Collection Handles

```js
const contacts = app.solid.data.contacts

await contacts.sync()
contacts.list()
contacts.get(id)
await contacts.create(data)
await contacts.update(idOrObject, changes)
await contacts.delete(idOrObject)
await contacts.saveAll()
```

`create()`, `update()`, and `delete()` save by default. Pass `{ save: false }` to stage locally.

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

SimplySolid owns beginner-facing app service shape and collection handles. Solid Workspace owns source tracking and save semantics. Lading owns Solid HTTP. Metro-OIDC owns authentication. Metro-OLDM/OLDM own linked-data parsing/writing.
