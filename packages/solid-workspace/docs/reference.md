# Solid Workspace reference

Solid Workspace is the source-aware data layer over OLDMed graph resources. It loads local and Solid resources into one working set, tracks where objects came from, and writes changes back with per-resource status.

It does not provide authentication, RDF parsing, filesystem operations, SimplyFlow bindings, setup conventions, or UI state.

The workspace model is local-first. Applications should be able to open local sources, keep rendering and writing while offline, then sync with Solid sources when network and authorization return.

## Exports

```js
import {
  workspace,
  collection,
  resource,
  graph,
  local,
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
  solid
}
```

## Source descriptors

```js
solid.resource(url, options)
solid.container(url, options)
solid.client(solidClient)
graph.resource(options)
local.memory(id, options)
local.indexedDB(name, options)
resource(id, { local, remote })
```

Options:

- `id`: stable source id. Defaults to the URL.
- `readOnly`: prevents writes to this source.
- `shape`: optional oldm-shape used before saving.
- `options`: read options passed to Solid API.
- `writeOptions`: write options passed to Solid API.

Container URLs are normalized to a trailing slash.

## `workspace(options)`

```js
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

Options:

- `solid`: a Solid API client.
- `context`: an existing OLDM context. Otherwise the workspace creates one.
- `sources`: source descriptors.
- `resources`: logical resource descriptors from `resource()`.
- `collections`: named collection descriptors.

Source descriptors are the low-level replica contract. Logical resources group replicas so IndexedDB, memory, and file-backed replicas can participate in the same application resource as a Solid replica.

`graph.resource()` is the low-level contract for a graph resource source:

```js
graph.resource({
  id: 'local-notes',
  url: 'memory://local-notes',
  async load() {
    return turtleText
  },
  async save(turtleText) {
    await storage.write(turtleText)
    return { ok: true, status: 'saved' }
  }
})
```

`local.memory()` is the simplest convenience factory:

```js
const localNotes = local.memory('local-notes', {
  prefixes,
  turtle: ''
})
```

It can be used without a Solid API client:

```js
const ws = workspace({
  sources: [localNotes]
})

await ws.load()
```

`local.indexedDB()` stores Turtle in browser IndexedDB:

```js
const localNotes = local.indexedDB('margin-notes', {
  id: 'notes:local',
  key: 'notes',
  prefixes,
  turtle: ''
})
```

Options:

- `id`: stable source id. Defaults to `${name}:${key}`.
- `key`: document key inside the object store. Defaults to `id` or `default`.
- `store`: object store name. Defaults to `resources`.
- `databaseVersion`: IndexedDB schema version. Defaults to `1`.
- `turtle`: initial Turtle text when the key has not been stored; defaults to empty text.
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
  solid.client(solidClient),
  resource('notes', {
    remote: solid.resource(notesUrl, {
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
ws.setClient(solidClient)
ws.addSource(source)
ws.context
ws.graph('notes')
await ws.sync('notes')

ws.sourceOf(object)
ws.sourcesOf(object, predicate, value)

await ws.createIn('contacts', object)
await ws.save(object)
await ws.delete(object)
await ws.saveAll()
```

`load()` reads configured sources. Resource sources read through the configured Solid API client's `client.get(url)`. Container sources call the Solid API `contains(url)` helper and then load each contained resource.

`open()` is the application-facing alias for loading resources and sources. Pass a logical resource id, source id, source descriptor, array of sources, or `{ sources }` options.

`open()` is tolerant by default for local-first applications: if one source fails, the failure is recorded in `workspace.status.sources[sourceId]` and other sources remain available. Use `load()` or `open({ throwOnError: true })` when a caller wants strict failure behavior.

`add()` accepts only explicit workspace parts returned by factories such as `resource()`, `local.memory()`, `solid.client()`, `solid.resource()`, or `graph.resource()`. It also accepts arrays of those parts, returns the same workspace for fluent composition, and throws for plain objects.

Logical `resource()` parts group replicas of the same conceptual document:

```js
resource('notes', {
  local: local.memory('notes:local'),
  remote: solid.resource(notesUrl, { id: 'notes:solid' })
})
```

When a logical resource has a local replica, `graph('notes')` reads from the local working copy. Opening the resource reconciles the reachable remote graph back into that local copy. Saving through `createIn('notes', object)` writes locally and marks the remote replica `sync-pending` when one is configured.

Solid reads accept the native OLDM Graph returned by Metro-OLDM, or Turtle text.
Custom sources use one contract: `load()` returns Turtle text, and `save(turtle)`
commits it. Memory and IndexedDB sources implement the same contract. Storage
completion and errors remain the adapter's responsibility.

`ws.context` owns the live source graphs. `ws.graph(sourceId)` returns a loaded
source graph or `null`; a logical resource id selects its local replica when
configured, otherwise its remote replica. Container children have separate
resource graphs, available through `ws.context.graph(resourceUrl)`.

Collections return graph-local OLDM nodes. Context subject lookup provides the
union across graphs; when editing a union view, explicitly select the owning
graph with OLDM's graph option. Use `collection.update(node, changes)` for
linked-object updates so referenced named subjects remain attached to the same
graph. The supplied fields replace their prior values; omitted facts survive.

`sourceOf()` and `sourcesOf(object, predicate, value)` use OLDM fact provenance
and add workspace source metadata. A fact absent from the context has no source.
Transport-owned objects are imported; their references are not editable handles
into this workspace. `createIn()` likewise returns a new native graph node;
retain that return value. An input without an id receives a stable UUID URN.

Successful refresh and replica sync replace source graphs. Re-read a collection
or graph before the next edit; saving an old node or a detached document object
is rejected. A failed direct-resource read keeps the prior working graph.
Queued saves capture their graph snapshot when admitted. Existing replica
revision checks continue to protect newer admitted saves during open/sync.

There is no serialized workspace document model or automatic migration.
Arbitrary objects without an RDF identity are rejected as predicate values.
Use OLDM BlankNodes for blank nodes and encode application literals explicitly.
Workspace does not know editor or annotation formats.

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

HTTP `401` and `403` are reported as `auth-needed`. Solid resource reads returning `404` or `410` open as empty graphs. Network/client absence is reported as `offline`.

Local writes can mark a remote source as pending:

```js
await ws.createIn('notes', note)
```

A result with `status: 'synced'` clears the pending marker. A newer local save admitted during sync instead returns `status: 'sync-pending'`; sync again to send that revision.

## Native graphs and replica sync

Read across resources with `ws.context.get(subjectId)` or `ws.context.subjects`.
Read and edit a particular source with `ws.graph(sourceId)`. For a logical
resource, `ws.graph(resourceId)` selects its local working copy when configured.

`await ws.sync('notes')` reads the current remote graph, reconciles it with the
local graph, commits locally, then writes remotely. The result's `graph` is the
detached native graph used for that operation; obtain fresh working nodes from
the workspace after sync. Internal graph snapshots protect admitted saves and
in-flight sync; they are not a separate application data format.

Logical-resource sync honors `lm:deleted` on original subjects and
`dcterms:modified` for explicitly declared `scalarPredicates`. Unknown facts
remain additive. See [Replica save contract](../../../docs/DESIGN_NOTES/REPLICA_SAVE_CONTRACT.md)
for ordering, failure, timestamp, and concurrency limits. A remote failure leaves
a useful local copy and pending status.

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
- `shape.for`: matching `a` values.

`create(object)` applies shape defaults and validates the object. By default it imports the object into the source graph without saving immediately; use the returned node for later edits. Pass the returned node to `contacts.save(node)`, or use `contacts.saveAll()`, to write.

## Save status

A subject save writes its complete owning resource graph as Turtle, retaining
other subjects and facts in that graph. An HTTP DELETE on a direct Solid source
still deletes the resource. Logical-resource deletion instead persists the
existing `lm:deleted` marker on the subject.


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

`saveAll()` returns all statuses when every save succeeds. If any save fails, it throws an error with `error.statuses` and `error.cause.failures`.
