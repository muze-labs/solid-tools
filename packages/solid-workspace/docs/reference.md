# Solid Workspace reference

Solid Workspace is the source-aware data layer over OLDMed graph resources. It loads local and Solid resources into one working set, tracks where objects came from, and writes changes back with per-resource status.

It does not provide authentication, RDF parsing, filesystem operations, SimplyFlow bindings, setup conventions, or UI state.

The long-term workspace model is local-first. Applications should be able to open local sources, keep rendering and writing while offline, then sync with Solid sources when network and authorization return.

## Exports

```js
import {
  workspace,
  collection,
  resource,
  graph,
  local,
  mergeGraphDocuments,
  solid,
  SolidWorkspace,
  WorkspaceCollection
} from '@muze-labs/solid-workspace'
```

Default export:

```js
{
  packageName,
  workspace,
  collection,
  resource,
  graph,
  local,
  mergeGraphDocuments,
  solid
}
```

## Source descriptors

```js
solid.resource(url, options)
solid.turtleResource(url, options)
solid.container(url, options)
solid.client(ladingClient)
graph.resource(options)
local.memory(id, options)
local.indexedDB(name, options)
resource(id, { local, remote })
```

Options:

- `id`: stable source id. Defaults to the URL.
- `readOnly`: prevents writes to this source.
- `shape`: optional oldm-shape used before saving.
- `options`: read options passed to Lading.
- `writeOptions`: write options passed to Lading.

Container URLs are normalized to a trailing slash.

## `workspace(options)`

```js
const ws = workspace({
  solid,
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

Options:

- `solid`, `lading`, or `client`: a Lading client.
- `sources`: source descriptors.
- `resources`: logical resource descriptors from `resource()`.
- `collections`: named collection descriptors.

Source descriptors are the low-level replica contract. The local-first design adds logical resources so IndexedDB, memory, and file-backed replicas can participate in the same application resource as a Solid replica.

`graph.resource()` is the low-level contract for a graph resource source:

```js
graph.resource({
  id: 'local-notes',
  url: 'memory://local-notes',
  async load() {
    return oldmedGraphDocument
  },
  async save(document) {
    return { ok: true, status: 'saved', document }
  },
  async turtle() {
    return turtleText
  }
})
```

`local.memory()` is the simplest convenience factory:

```js
const localNotes = local.memory('local-notes', {
  prefixes,
  document: {
    format: 'oldmed-graph',
    version: 1,
    prefixes,
    subjects: []
  }
})
```

It can be used without a Lading client:

```js
const ws = workspace({
  sources: [localNotes]
})

await ws.load()
```

`local.indexedDB()` stores an OLDMed graph document in browser IndexedDB:

```js
const localNotes = local.indexedDB('margin-notes', {
  id: 'notes:local',
  key: 'notes',
  prefixes,
  document: {
    format: 'oldmed-graph',
    version: 1,
    prefixes,
    subjects: []
  }
})
```

Options:

- `id`: stable source id. Defaults to `${name}:${key}`.
- `key`: document key inside the object store. Defaults to `id` or `default`.
- `store` or `storeName`: object store name. Defaults to `resources`.
- `databaseVersion`: IndexedDB schema version. Defaults to `1`.
- `document`: initial graph document returned when the key is not stored yet.
- `prefixes`: prefixes used when exporting Turtle.

The factory uses `globalThis.indexedDB` in the browser. Tests or non-browser callers may pass an `indexedDB` implementation explicitly.

For PWA-style apps, prefer a logical resource with a local working copy:

```js
const ws = workspace()
  .add(resource('notes', {
    local: local.indexedDB('margin-notes', {
      id: 'notes:local',
      key: 'notes',
      prefixes
    })
  }))

await ws.open('notes')
```

When Solid becomes available later, keep the workspace and add the remote replica:

```js
const solidParts = [
  solid.client(ladingClient),
  resource('notes', {
    remote: solid.turtleResource(notesUrl, {
      id: 'solid-notes'
    })
  })
]

ws.add(solidParts)

await ws.open('notes')
await ws.sync('notes')
```

## Workspace methods

```js
await ws.load()
await ws.load({ sources: ['contacts'] })
await ws.loadSource('contacts')
await ws.open()
await ws.open('contacts')

ws.add(source)
ws.add(resource('notes', { local, remote }))
ws.add([source, resource])
ws.setClient(ladingClient)
ws.addSource(source)
ws.dataset()
ws.dataset('notes')
await ws.sync({ from: ['local'], into: 'remote' })
await ws.sync('notes')

ws.track(object, options)
ws.sourceOf(object)
ws.sourcesOf(object, predicate, value)

await ws.createIn('contacts', object)
await ws.save(object)
await ws.delete(object)
await ws.saveAll()
```

`load()` reads configured sources. Resource sources call `solid.resource(url).get()`. Container sources call `solid.container(url).contains()` and then load each contained resource.

`open()` is the application-facing alias for loading resources and sources. Pass a logical resource id, source id, source descriptor, array of sources, or `{ sources }` options.

`open()` is tolerant by default for local-first applications: if one source fails, the failure is recorded in `workspace.status.sources[sourceId]` and other sources remain available. Use `load()` or `open({ throwOnError: true })` when a caller wants strict failure behavior.

`add()` accepts only explicit workspace parts returned by factories such as `resource()`, `local.memory()`, `solid.client()`, `solid.turtleResource()`, or `graph.resource()`. It also accepts arrays of those parts, returns the same workspace for fluent composition, and throws for plain objects.

Logical `resource()` parts group replicas of the same conceptual document:

```js
resource('notes', {
  local: local.memory('notes:local'),
  remote: solid.turtleResource(notesUrl, { id: 'notes:solid' })
})
```

When a logical resource has a local replica, `dataset('notes')` reads from the local working copy. Opening the resource reconciles the reachable remote graph back into that local copy. Saving through `createIn('notes', object)` writes locally and marks the remote replica `sync-pending` when one is configured.

Loaded objects are read from Metro-OLDM-shaped response data:

- `response.data.subjects`
- `response.data.data`
- `response.data.primary`
- `response.data`

`sourceOf()` returns the tracked source for an object. When a parsed OLDM context exposes `context.sources()`, `sourcesOf(object, predicate, value)` delegates fact-level source lookup to it.

## Status

The workspace exposes source-level status:

```js
workspace.status
workspace.status.sources['local-notes']
workspace.status.sources['solid-notes']
```

Source status shape:

```js
{
  id,
  type,
  url,
  local,
  logicalResource,
  replica,
  state,
  error,
  syncPending,
  pendingFrom
}
```

Common source states:

- `idle`
- `opening`
- `ready`
- `offline`
- `auth-needed`
- `syncing`
- `sync-pending`
- `error`

HTTP `401` and `403` are reported as `auth-needed`. Missing resources can open as empty graph documents. Network/client absence is reported as `offline`.

Local writes can mark a remote source as pending:

```js
await ws.createIn('notes', note)
```

A successful `sync('notes')` clears the pending marker.

## Open-World Dataset

`dataset()` returns a single graph document view over selected workspace sources:

```js
const graph = ws.dataset({ sources: ['local', 'remote'] })
const notes = ws.dataset('notes')
```

The dataset uses open-world additive merging. Subjects with different ids are preserved. Subjects with the same id are combined by preserving known facts; conflicting predicate values become multi-values instead of being treated as deletion or replacement.

`mergeGraphDocuments()` exposes the same pure merge primitive for callers that already have graph documents:

```js
const graph = mergeGraphDocuments([
  localDocument,
  remoteDocument
])
```

For logical resources, `sync()` reconciles the local working copy and current remote graph, writes the merged document to the remote replica, then stores it locally:

```js
await ws.sync('notes')
```

The source-to-source form projects a dataset into a writable resource source:

```js
await ws.sync({
  from: ['local'],
  into: 'remote'
})
```

This is intentionally additive. It does not interpret absence as deletion and does not resolve semantic conflicts beyond preserving all values.

For PWA-style apps, local replicas should be first-class working copies rather than opaque caches of Solid resources. Remote source failures should become source status such as `offline` or `auth-needed`, while the workspace continues serving the local dataset.

## Collections

```js
const contacts = ws.collections.contacts

contacts.list()
contacts.get(id)
await contacts.create(object)
contacts.update(object, changes)
await contacts.delete(object)
await contacts.save(object)
await contacts.saveAll()
```

A collection can filter by:

- `sources`: source ids.
- `shape.class`: matching `rdf$type` values.

`create(object)` applies shape defaults and validates the object. By default it tracks the object without saving immediately. Use `contacts.save(object)` or `contacts.saveAll()` to write.

## Save status

`save()` returns a status object:

```js
{
  ok,
  status,
  object,
  source,
  sourceUrl,
  response,
  error,
  issues
}
```

Common statuses:

- `created`
- `saved`
- `deleted`
- `validation_failed`
- `read_only`
- `error`

`saveAll()` returns all statuses when every save succeeds. If any save fails, it throws an error with `error.statuses` and `error.failures`.
