# Turtle-backed local-first workspace

## Status

Design decision draft.

This note refines the local-first workspace design after reviewing the boundary between `oldm` and `solid-workspace`.

It supersedes the earlier idea that a workspace source should persist an `oldmed-graph` JSON document. OLDMed JavaScript objects are still the runtime object shape, but the serialized linked-data format for resources is Turtle.

## Decision summary

`oldm` should own the in-memory linked-data world:

- Turtle parsing and writing;
- `Context` and `Graph`;
- a combined open-world context view over multiple graphs;
- graph-level and fact-level source lookup through `context.sources(...)`;
- graph mutation helpers such as `set`, `add`, and `delete`.

`solid-workspace` should own local-first workspace semantics:

- source and replica descriptors;
- opening local and remote resources;
- source availability status such as `ready`, `offline`, `auth-needed`, and `sync-pending`;
- local-first write routing;
- additive sync policy between replicas;
- app-facing logical resources such as `resource('notes', { local, remote })`.

The serialized form of every resource, local or remote, should be Turtle. IndexedDB is only a storage transport for local Turtle resources.

## Core model

A workspace is a set of Turtle resources opened into one OLDM context.

For reading, the application can use the combined context view:

```js
const context = oldm.context({ prefixes })

const localGraph = context.parse(localTurtle, localUrl, 'text/turtle')
const remoteGraph = context.parse(remoteTurtle, remoteUrl, 'text/turtle')

context.data
context.subjects
context.sources(context.get(noteId), 'schema$text')
```

For writing, each persisted unit remains a graph:

```js
localGraph.set(noteId, 'schema$text', 'Updated text')
const turtle = await localGraph.write()
```

The combined context is a runtime view, not a new serialized data resource. Persisting a combined view should only happen when workspace sync policy explicitly projects known facts into a target graph.

## Workspace manifests

There is one case where a single resource may describe a workspace: a manifest.

A workspace manifest is itself Turtle. It describes which Turtle resources an app should open together. It does not serialize the combined data graph.

Example:

```turtle
@prefix ws: <https://muze.nl/ns/workspace#> .
@prefix dcterms: <http://purl.org/dc/terms/> .

<#workspace>
    a ws:Workspace ;
    dcterms:title "Margin notes workspace" ;
    ws:includes <./notes.ttl> ;
    ws:includes <./settings.ttl> ;
    ws:includes <https://example.org/shared/annotations.ttl> .
```

Opening this manifest means:

1. read the manifest Turtle;
2. parse it with OLDM;
3. resolve `ws:includes` resources;
4. load each included Turtle resource into the same OLDM context;
5. keep the included resources as separate graphs for save and sync.

The manifest may later grow terms for preferred local replicas, read-only resources, labels, app profile, or sync policy, but it should remain a graph of workspace configuration, not an application-data dump.

## Local replicas in IndexedDB

An IndexedDB-backed local source should store a local Turtle resource.

Preferred stored value:

```js
{
  url: 'urn:muze:local:margin-notes:chapter-1',
  contentType: 'text/turtle',
  body: turtle
}
```

The IndexedDB key can supply the local resource identity, so a minimal implementation may store only:

```js
turtle
```

as long as the source descriptor knows the local graph URL and content type.

The important constraint is that the payload is Turtle. The local source should not persist:

```js
{
  format: 'oldmed-graph',
  version: 1,
  prefixes,
  subjects
}
```

That shape may remain useful in tests or internal adapters during transition, but it should not be the long-term source format.

## Margin-notes example

Margin-notes should treat the local notes resource and the remote Solid notes resource as replicas of one logical resource:

```js
resource('notes', {
  local: local.indexedDB('margin-notes-workspace', {
    id: 'notes:local',
    key: 'notes',
    url: 'urn:muze:local:margin-notes:notes',
    prefixes: annotationPrefixes
  }),
  remote: solid.turtleResource(notesUrl, {
    id: 'notes:solid'
  })
})
```

Both replicas contain Web Annotation Turtle using the same vocabulary:

- `oa:Annotation`;
- `oa:hasBody`;
- `oa:hasTarget`;
- `oa:FragmentSelector`;
- `dcterms:created`;
- `dcterms:modified`;
- `schema:text`;
- `cobalt:fragment` where the app needs Cobalt body data.

The app works against the `notes` logical resource. The workspace chooses the local replica as the local-first working copy. When Solid is connected, the remote Turtle graph is loaded into the same context and reconciled into the local working copy. Local writes update the local Turtle graph and mark the remote replica `sync-pending`.

## Sync semantics

Sync remains a `solid-workspace` concern.

For the first implementation slice, sync should stay additive:

1. load current remote Turtle if reachable;
2. compare it with the local working graph through the OLDM context view;
3. preserve known subjects and facts from both sides;
4. write the merged facts to the remote graph;
5. write the same merged facts back to the local graph;
6. clear `sync-pending` after both writes succeed.

This does not make the combined context a canonical persisted format. It is a sync operation that materializes selected facts into a target Turtle resource.

Deletion and conflict handling remain explicit future policy. Absence in one graph must not be interpreted as deletion in another graph during the first additive sync implementation.

## Changes needed in `solid-workspace`

### Replace persisted graph documents with Turtle resources

Change `local.memory()` and `local.indexedDB()` so their source contract is Turtle-backed:

```js
local.indexedDB(name, {
  id,
  key,
  url,
  contentType: 'text/turtle',
  body,
  prefixes
})
```

The source should expose operations such as:

```js
async loadText()
async saveText(turtle)
async loadGraph({ context })
async saveGraph(graph)
```

The exact method names can differ, but the contract should make Turtle the stored value and OLDM `Graph` the runtime value.

### Keep one OLDM context per workspace open

`SolidWorkspace` should keep a current `oldm.context(...)` for loaded graph resources. Loading a source should parse its Turtle into that context and track the returned `Graph`.

The workspace still needs source records, but those records should point to source descriptors and OLDM graphs rather than plain cloned subject documents.

### Make `dataset()` a context snapshot

`workspace.dataset()` should return the app-facing view derived from the current OLDM context and selected workspace sources.

During transition, it may keep returning `{ subjects: [...] }` for API compatibility, but the implementation should use OLDM `Context`/`Graph` as the source of truth. Longer term, consider returning an object that exposes both:

```js
{
  context,
  graphs,
  subjects
}
```

### Remove or isolate `oldmed-graph`

The current helpers in `solid-workspace/src/index.mjs` should either disappear or move behind compatibility adapters:

- `graphDocumentFrom`;
- `cloneGraphDocument`;
- `mergeGraphDocuments`;
- `graphDocumentToTurtle`;
- manual `writeSubjectToGraph`;
- manual value equality and merge helpers.

The desired replacement is OLDM graph/context operations plus a small workspace-level materialization function for sync.

### Preserve source status and write routing

Keep these in `solid-workspace`:

- `open()` tolerant behavior;
- `load()` strict behavior;
- `resource(id, { local, remote })`;
- `createIn(resourceId, object)`;
- `save()`;
- `sync()`;
- `sync-pending`;
- read-only source checks;
- offline/auth error classification.

Those are not OLDM responsibilities.

## Changes needed in `simplysolid`

`simplysolid` should keep generating local-first resources for beginner apps, but its local configuration should now produce Turtle-backed IndexedDB sources.

Current configuration like:

```js
local: {
  database: 'margin-notes-workspace',
  key: 'notes',
  prefixes
}
```

should remain valid. Internally it should create a `local.indexedDB()` source whose persisted payload is Turtle.

`app.solid.dataset(...)`, collection handles, and `connect(...)` should not expose the IndexedDB/Turtle distinction to app code.

## Changes needed in `oldm`

Do not add a new canonical JSON document format.

Useful OLDM additions would be narrow helpers around existing concepts:

- parse several Turtle resources into one context, for example `context.parseAll([{ url, type, body }])`;
- create a graph from OLDMed runtime objects when a caller explicitly wants to materialize objects into a graph;
- expose semantic comparison or diff helpers for graphs/facts if sync needs them;
- make it easy to ask for graph-specific and context-combined snapshots without losing provenance.

All persisted output should still be Turtle through `graph.write()`.

## Migration path

1. Add Turtle-backed local source implementations alongside the current `oldmed-graph` sources.
2. Teach `local.indexedDB()` to read old JSON graph documents and rewrite them as Turtle on the next save.
3. Switch tests to assert stored Turtle for new local resources.
4. Update `solid-workspace` sync tests to verify that local and remote replicas are Turtle graphs loaded into one context.
5. Switch margin-notes default local-first notes to the Turtle-backed source.
6. Keep the old margin-notes custom store boundary unchanged for hosts that pass opaque app values.
7. Remove public docs that describe `oldmed-graph` as the desired source format.

## Non-goals

- No new `oldm.document()` JSON interchange format.
- No application-specific margin-notes merge code.
- No deletion semantics beyond explicit local delete status in this slice.
- No type-index, inbox, publication, or permission UI in this slice.
- No requirement that every app use a workspace manifest.

## Open questions

- What vocabulary should define workspace manifests? A temporary Muze namespace is enough for experiments, but the terms should be documented.
- Should local graph URLs use `urn:` identifiers, `indexeddb:` URLs, or app-defined URLs?
- Should `dataset()` continue returning a plain `{ subjects }` object for compatibility, or should it become an OLDM context/graph view?
- Should sync materialization live entirely in `solid-workspace`, or should OLDM expose a small graph projection helper?
