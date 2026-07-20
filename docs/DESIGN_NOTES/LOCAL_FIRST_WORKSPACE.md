# Local-first workspace design

## Status

First draft. This note captures the design pressure found while connecting margin-notes to a Solid Pod from a local-first browser app.

The central premise is now stronger than "Solid with a local fallback":

> SimplySolid should support PWA-style applications whose primary runtime keeps working without network access, and whose Solid resources participate as syncable workspace sources when they are reachable and authorized.

## Problem

SimplySolid was initially shaped around Solid-backed resources and containers. PWA-style web applications need local-first behavior as a core workspace feature:

- an app may create useful data before the reader connects a WebID;
- a PWA may keep editing while offline;
- local writes should have a reliable commit path even when remote writes cannot run;
- a local graph and a remote Solid resource may both contain valid knowledge about the same application dataset;
- a remote Solid source may be offline, unauthorized, stale, or partially synced without making the whole workspace unusable;
- reconnecting should not force the application to decide low-level graph reconciliation rules.

Margin-notes exposed the problem. The app can have one notes graph in IndexedDB and another notes graph in a remote Turtle resource. Treating that as an application-specific merge is the wrong boundary. It is resource/workspace behavior.

The application should work with a logical resource. That resource may have a local replica and a remote Solid replica. The local replica is the working copy that keeps the PWA usable; the remote replica participates when it is reachable and authorized.

## Design Direction

A workspace is a source-aware OLDMed working set. It should be able to contain logical resources, regardless of where their replicas live, and expose them as one open-world dataset.

For local-first applications, the workspace should be useful as soon as local sources are open. Remote sources can join later, fail independently, and sync when possible. Network failure is source status, not application failure.

The central in-memory representation is the OLDMed object graph:

```js
{
  format: 'oldmed-graph',
  version: 1,
  prefixes: {
    schema: 'https://schema.org/'
  },
  subjects: [
    {
      id: 'urn:example:thing',
      rdf$type: 'schema$Thing',
      schema$name: 'Example'
    }
  ]
}
```

Every workspace source should be able to return that shape. Every resource, no matter where it is stored, should also be able to produce a Turtle representation of its graph. Turtle is the portable linked-data file format; OLDMed objects are the application/runtime model.

The workspace design should therefore optimize for this flow:

```txt
open local sources
render useful app state
record local writes
attempt remote source connection when possible
sync pending/local facts to remote resources
keep rendering from the workspace dataset throughout
```

## Resource Sources

Solid Workspace currently has Solid-specific descriptors:

```js
solid.resource('https://pod.example/app/notes.ttl', { id: 'remote' })
solid.container('https://pod.example/app/contacts/', { id: 'contacts' })
```

Local-first work needs a more general resource source contract. A possible shape:

```js
graph.resource({
  id: 'local-notes',
  url: 'indexeddb://margin-notes/chapter-01',

  async load() {
    return oldmedGraphDocument
  },

  async save(document) {
    return { ok: true, status: 'saved' }
  },

  async turtle() {
    return '@prefix schema: <https://schema.org/>. ...'
  }
})
```

`graph.resource()` is the low-level escape hatch. Most applications should use source factories that fill in the repeated contract details.

Preferred application-facing shape:

```js
import { workspace, resource, local, solid } from '@muze-labs/solid-workspace'

const localParts = [
  resource('notes', {
    local: local.memory('notes:local', {
      prefixes: annotationPrefixes,
      document: emptyNotesDocument
    })
  }),
  resource('settings', {
    local: local.memory('settings:local', {
      prefixes: settingsPrefixes,
      document: emptySettingsDocument
    })
  })
]

const notes = workspace()
  .add(localParts)

await notes.open()

// Later, after Solid connection/discovery:
const solidParts = [
  solid.client(ladingClient),
  resource('notes', {
    remote: solid.turtleResource(connection.resourceUrl, {
      id: 'notes:solid',
      prefixes: annotationPrefixes
    })
  })
]

notes.add(solidParts)

await notes.open('notes')
await notes.sync('notes')
```

The factory families should grow from the concrete source types applications need:

```js
local.memory(id, options)
local.indexedDB(name, options)
local.localStorage(name, options)
solid.client(ladingClient)
solid.turtleResource(url, options)
solid.turtleContainer(url, options)
resource(id, { local, remote })
graph.resource(options)
```

`workspace.add()` should accept either one explicit workspace part or an array of explicit workspace parts returned by these factories. It should reject arbitrary objects, even if they look source-like. This keeps the fluent API compact without making it magical, while still letting applications move sets of resources around as data.

Logical `resource()` parts are the app-facing concept. Source factories are lower-level replicas. Applications can still add a source directly for advanced cases, but normal PWA code should open, save, and sync by logical resource id.

`workspace.open()` is the local-first application entry point. It should be tolerant by default: source failures update source status, while the workspace continues serving data from sources that did open. Lower-level `workspace.load()` can remain strict for tests and tools that want an exception.

Solid-backed replicas can implement the same contract by reading/writing Turtle through Lading and Metro-OLDM. IndexedDB-backed replicas can store OLDMed graph documents directly and serialize to Turtle when asked.

The first persistent local replica should be `local.indexedDB(name, options)`. It stores one OLDMed graph document per key in a browser IndexedDB object store, while still exposing the same `load()`, `save(document)`, and `turtle()` source contract as `local.memory()`.

The workspace should not care whether the source is backed by:

- Solid over HTTP;
- IndexedDB;
- local files;
- memory in tests;
- another future sync transport.

It should care that the source can expose a graph document, can be identified, and can declare whether it is writable.

## Logical Resources And Replicas

A logical resource groups replicas of the same conceptual document:

```js
resource('notes', {
  local: local.indexedDB('workspace-cache', {
    key: 'notes'
  }),
  remote: solid.turtleResource(notesUrl, {
    id: 'notes:solid'
  })
})
```

Expected behavior:

```txt
first online open:
  open local replica
  fetch remote Turtle
  reconcile local and remote
  store the merged graph in the local replica
  render from the local working copy

offline reopen:
  open local replica
  remote replica reports offline
  render last known graph from the local working copy

offline edit:
  save to local replica
  mark remote replica sync-pending

later online sync:
  fetch current remote Turtle
  reconcile remote graph with local working copy
  write merged graph to remote
  store merged graph locally
  clear sync-pending
```

This is different from treating local and remote as unrelated peer sources. The app works with `notes`; local and remote are replicas of `notes`.

## Source Availability

Each source/replica should have its own status. A workspace may be "ready" while one source is offline or needs authorization.

Useful first statuses:

- `idle`
- `opening`
- `ready`
- `offline`
- `auth-needed`
- `syncing`
- `sync-pending`
- `error`

The workspace should expose enough status for applications to show honest UI:

```js
workspace.status.sources['local-notes'].state // 'ready'
workspace.status.sources['solid-notes'].state // 'offline'
```

The important rule is that a remote source failure should not discard or block local data. A failed Solid request means that source cannot currently participate; it does not make the workspace dataset empty.

Source failures should be classified into useful states when possible:

- HTTP `401` and `403` become `auth-needed`;
- missing resources can open as empty graph documents;
- network/client absence can become `offline`;
- other failures become `error`.

## Write Model

For PWA-style apps, writes should commit locally first.

Conceptual flow:

```js
const note = await workspace.createIn('notes', {
  id: 'urn:note:chapter-01:margin-12',
  rdf$type: 'schema$Comment',
  schema$text: 'Useful spell.'
})

note.schema$text = 'Useful spell, revisit.'
await workspace.save(note)
```

Later, when the remote replica is reachable:

```js
await workspace.sync('notes')
```

This does not require the first implementation slice to introduce an operation log. But the API shape should leave room for dirty markers, tombstones, and pending sync state. We should avoid APIs that assume every save can immediately reach the network.

The first implementation can support a small explicit marker:

```js
await workspace.createIn('notes', note)

workspace.status.sources['solid-notes'].state // 'sync-pending'
workspace.status.sources['solid-notes'].syncPending // true
```

The logical resource decides that local writes should mark its remote replica as pending. Application code should not need to know the source ids for the normal path.

## Dataset Semantics

`workspace.dataset()` returns an open-world union of selected sources.

Rules for the first slice:

- subjects with different ids are all preserved;
- subjects with the same id are combined;
- facts from both sources are preserved;
- conflicting values become multi-values;
- absence does not mean deletion;
- source provenance is retained by workspace records where possible.

This is intentionally additive. It matches RDF's open-world posture and avoids false data loss when a local or remote source is incomplete.

## Sync Semantics

Sync is separate from the read model.

Reading:

```js
const graph = workspace.dataset({
  resources: ['notes']
})
```

Syncing:

```js
await workspace.sync('notes')
```

For the first local-first slice, sync means additive projection:

1. load the local working copy;
2. load the current remote graph if possible;
3. reconcile local and remote facts;
4. write the merged graph to the remote replica when available;
5. write the merged graph back to the local replica;
6. clear sync-pending state after a successful remote write.

Deletion, conflict resolution, change feeds, tombstones, operation logs, and last-write-wins policy are explicit non-goals for the first slice. They should be added only when the workspace has enough provenance to make them honest.

The older source-to-source form remains useful for tests, migration tools, and advanced callers:

```js
await workspace.sync({
  from: ['local-notes'],
  into: 'solid-notes'
})
```

## Turtle Requirement

Each resource source should be able to provide a Turtle string or file-like body for inspection, export, and Solid interoperability.

This does not mean the app authors Turtle by hand. The normal path is:

```txt
OLDMed object graph
  -> source.save(document)
  -> source.turtle()
  -> transport/file write
```

For Solid resources, Turtle may be the canonical persisted representation. For local resources, Turtle may be derived from the stored OLDMed graph document.

The important invariant is that a resource is not just an opaque JavaScript cache. It remains explainable and portable as linked data.

## Package Ownership

`solid-workspace` should own:

- generic resource source descriptors;
- logical resources with local and remote replicas;
- loading sources into OLDMed graph documents;
- local-first source availability status;
- source-aware dataset union;
- local commit paths for writable local sources;
- additive resource-to-resource sync;
- read-only source enforcement;
- source provenance in the working set.

`simplysolid` should own:

- app-facing setup of local and remote sources;
- PWA-friendly defaults where a local workspace source opens before Solid is connected;
- exposing workspace status through `app.solid`;
- beginner-friendly conventions for app storage and local-first defaults.

Applications such as margin-notes should own:

- their domain shape;
- which sources they want;
- when to connect;
- what UI to show during sync;
- domain-specific validation before rendering.

## Margin-notes Migration Sketch

Current transitional behavior:

```txt
load local notes
connect Solid
load remote notes
merge graph documents
save remote notes
render merged notes
```

Desired behavior:

```txt
create workspace
add notes resource with local replica
render workspace dataset from notes local working copy
save edits to notes local replica

on Solid connect:
  add remote replica to notes
  open notes
  sync notes if pending or changed
  render workspace dataset

while offline:
  keep saving to notes local replica
  mark notes remote replica sync pending
```

This lets the margin-notes app talk about notes and connection state, while SimplySolid/Solid Workspace handle local-first source mechanics.

## Open Questions

- Is `graph.resource()` the right name for the low-level source contract, with `local.*` and `solid.*` factories for normal application code?
- Is `resource(id, { local, remote })` the right app-facing name for a logical local-first document?
- Should `source.turtle()` be required for all resource sources immediately, or should it be a capability checked by export/sync features?
- Should local sources store Turtle, OLDMed graph documents, or both?
- How should fact-level provenance survive after a dataset union?
- What is the smallest useful source status model for offline/auth-needed/sync-pending?
- Should pending sync state live in a sidecar metadata resource, in the local graph, or in workspace-managed local storage?
- What minimal deletion signal is compatible with open-world data and offline editing?
- Should conflict policy be configured per workspace, per source, or per sync operation?

## First Implementation Slice

The smallest useful slice should prove:

1. a memory or IndexedDB-backed resource source can load/save an OLDMed graph document;
2. the same source can produce Turtle from that document;
3. a logical resource can be backed by a local replica and later gain a remote Solid replica;
4. a workspace can open and serve a dataset when only the local replica is available;
5. a Solid replica can be added later when network/auth is available;
6. `workspace.dataset({ resources: ['notes'] })` returns the logical resource graph from the local working copy;
7. local writes continue while the remote replica is offline and leave visible sync-pending status;
8. `workspace.sync('notes')` writes an additive merge to the remote replica when it becomes available and updates the local replica;
9. margin-notes can replace its manual local/remote coordination with this resource/replica model.
