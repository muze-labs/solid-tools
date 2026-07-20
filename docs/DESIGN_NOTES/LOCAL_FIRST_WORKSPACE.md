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

Margin-notes exposed the problem. The app can have one notes graph in IndexedDB and another notes graph in a remote Turtle resource. Treating that as an application-specific merge is the wrong boundary. It is source/workspace behavior.

The local resource is not a cache of the remote resource. It is a first-class source in the workspace. The remote Solid resource is another first-class source whose availability changes over time.

## Design Direction

A workspace is a source-aware OLDMed working set. It should be able to contain multiple resources, regardless of where those resources live, and expose them as one open-world dataset.

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
import { workspace, local, solid } from '@muze-labs/solid-workspace'

const notes = workspace({
  sources: [
    local.memory('local-notes', {
      prefixes: annotationPrefixes,
      document: emptyNotesDocument
    })
  ]
})

await notes.load()

// Later, after Solid connection/discovery:
notes.setClient(ladingClient)
notes.addSource(
  solid.turtleResource(connection.resourceUrl, {
    id: 'solid-notes',
    prefixes: annotationPrefixes
  })
)

await notes.load({ sources: ['solid-notes'] })
await notes.sync({
  from: ['local-notes'],
  into: 'solid-notes'
})
```

The factory families should grow from the concrete source types applications need:

```js
local.memory(id, options)
local.indexedDB(name, options)
local.localStorage(name, options)
solid.turtleResource(url, options)
solid.turtleContainer(url, options)
graph.resource(options)
```

Solid-backed sources can implement the same contract by reading/writing Turtle through Lading and Metro-OLDM. IndexedDB-backed sources can store OLDMed graph documents directly and serialize to Turtle when asked.

The workspace should not care whether the source is backed by:

- Solid over HTTP;
- IndexedDB;
- local files;
- memory in tests;
- another future sync transport.

It should care that the source can expose a graph document, can be identified, and can declare whether it is writable.

## Source Availability

Each source should have its own status. A workspace may be "ready" while one source is offline or needs authorization.

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

## Write Model

For PWA-style apps, writes should commit locally first.

Conceptual flow:

```js
await workspace.save(object, {
  target: 'local-notes'
})

workspace.markSyncPending({
  from: 'local-notes',
  into: 'solid-notes'
})
```

Later, when the remote source is reachable:

```js
await workspace.sync({
  from: 'local-notes',
  into: 'solid-notes'
})
```

This does not require the first implementation slice to introduce an operation log. But the API shape should leave room for dirty markers, tombstones, and pending sync state. We should avoid APIs that assume every save can immediately reach the network.

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
  sources: ['local-notes', 'solid-notes']
})
```

Syncing:

```js
await workspace.sync({
  from: ['local-notes'],
  into: 'solid-notes'
})
```

For the first local-first slice, sync means additive projection:

1. load the source dataset;
2. load the target resource graph;
3. merge source facts into the target graph;
4. write the merged target resource back if it changed.

Deletion, conflict resolution, change feeds, tombstones, operation logs, and last-write-wins policy are explicit non-goals for the first slice. They should be added only when the workspace has enough provenance to make them honest.

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
add local notes resource source
render workspace dataset
save edits to local source

on Solid connect:
  add remote notes resource source
  load remote source
  sync local -> remote if pending or changed
  render workspace dataset

while offline:
  keep saving to local source
  mark remote sync pending
```

This lets the margin-notes app talk about notes and connection state, while SimplySolid/Solid Workspace handle local-first source mechanics.

## Open Questions

- Is `graph.resource()` the right name for the low-level source contract, with `local.*` and `solid.*` factories for normal application code?
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
3. a workspace can open and serve a dataset when only the local source is available;
4. a Solid resource source can be added later when network/auth is available;
5. `workspace.dataset()` returns their open-world union;
6. local writes continue while the remote source is offline and leave visible sync-pending status;
7. `workspace.sync({ from: 'local', into: 'remote' })` writes an additive merge to the target source when it becomes available;
8. margin-notes can replace its manual local/remote coordination with this source model.
