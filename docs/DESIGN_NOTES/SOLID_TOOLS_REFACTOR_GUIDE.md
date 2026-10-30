# Solid tools refactor guide

This note is the working guide for the current refactor of the Solid runtime stack.
The main direction is to flatten the stack: Metro owns HTTP client shape, OLDM owns
linked-data parsing/writing, Solid Workspace owns local/remote graph resources, and
SimplySolid owns the app-facing convenience layer.

## Goal

Reduce the number of packages that expose overlapping graph, HTTP, and application
semantics.

The target stack is:

```js
Metro + metro.solidApi
  -> Solid Workspace
    -> SimplySolid
```

OLDM and Metro-OLDM remain underneath as generic linked-data tools:

- `@muze-nl/oldm` parses/writes Turtle and manages vocabulary-agnostic contexts.
- `@muze-nl/metro-oldm` optionally parses HTTP responses into OLDMed runtime views.
- `metro.solidApi` gives a Metro `API` subclass a few Solid-specific HTTP helpers.
- `solid-workspace` composes local and remote Turtle resources into one working set.
- `simplysolid` exposes beginner-readable app services and collection handles.

## Step 1: create `metro.solidApi`

The first refactor step is to move the old Lading semantics into a Metro-style API
helper and drop Lading as a package.

In this repository that can start as a new package, for example
`@muze-labs/metro-solid`. Once stable, it can be upstreamed or mirrored as
`@muze-nl/metro-solid` and re-exported by Metro as `metro.solidApi`, in the same
spirit as `metro.jsonApi`.

The package should export:

```js
import { solidApi } from '@muze-labs/metro-solid'

const solid = solidApi('https://pod.example/', {
  async profile(webId) {
    return this.discoverWebId(webId)
  }
})

await solid.get('notes/a.ttl')
await solid.put('notes/a.ttl', {
  body: turtle,
  headers: { 'Content-Type': 'text/turtle' }
})
await solid.create('notes/a.ttl', turtle, { headers: { 'Content-Type': 'text/turtle' } })
await solid.patch('notes/a.ttl', {
  body: patch,
  headers: { 'Content-Type': 'application/sparql-update' }
})
await solid.delete('notes/a.ttl')

await solid.createContainer('notes/')
await solid.postToContainer('notes/', turtle, { headers: { Slug: 'a.ttl' } })
await solid.contains('notes/')

await solid.discoverWebId(webId)
await solid.discoverStorage(webId)
```

It should own only Solid HTTP affordances:

- Solid request headers.
- LDP container headers.
- `Location` and `ETag` helpers.
- `PUT`-with-`If-None-Match: *` safe create.
- LDP containment reads through `ldp:contains`.
- Automatic `metro-oldm` installation for linked-data parsing/writing.
- WebID/profile/storage discovery from parsed response data, using the default `pim$storage` key.

It should not own:

- authentication;
- Turtle parsing implementation;
- OLDM object mapping;
- IndexedDB;
- local-first sync;
- app setup conventions;
- shape validation;
- SimplyFlow bindings.

Exit criteria for step 1:

- all current Solid HTTP tests pass against `solidApi`;
- `@muze-labs/lading` is no longer part of the workspace;
- `solidApi(base, methods)` returns a Metro API object and can be used by JSFS-Solid, Solid Workspace, and SimplySolid;
- no application or graph semantics are added to the new package.

## Step 2: migrate callers from Lading to `solidApi`

After `solidApi` exists, update package docs and code to accept a Solid-capable Metro
API rather than a "Lading client".

Primary call sites:

- `@muze-labs/jsfs-solid`;
- `@muze-labs/solid-workspace`;
- `@muze-labs/simplysolid`;
- examples and tutorials.

During migration, accepting the neutral names is enough:

```js
const solid = options.solid ?? options.solidApi ?? options.client
```

The public docs should prefer `solidApi`.

Exit criteria:

- package APIs describe the dependency as a Solid API client, not as Lading;
- examples construct it with `solidApi(baseUrl, methods)`, passing a Metro client only when extra middleware such as authentication is needed;
- there are no live imports from `@muze-labs/lading`.

## Step 3: make Turtle the only persisted graph format

Local and remote resources should use the same serialized model: Turtle resources.
IndexedDB should store Turtle payloads and metadata, not an OLDMed JSON graph format.

The runtime may still expose OLDMed objects after parsing, but persistence stays RDF:

```js
{
  url,
  headers: { 'Content-Type': 'text/turtle' },
  body,
  etag,
  modified
}
```

Exit criteria:

- no new persisted `oldmed-graph` format is introduced;
- existing `oldmed-graph` support is isolated as migration compatibility if needed;
- all resource sources can expose both Turtle text and an OLDM graph view.

## Step 4: give Solid Workspace one OLDM context

Solid Workspace should lean on OLDM for the shared graph world. It should not
duplicate context, provenance, or subject lookup behavior.

Solid Workspace owns source lifecycle:

- logical resources;
- local and remote replicas;
- availability status;
- source-specific save state;
- source-to-source sync policy;
- recursive workspace manifest loading.

OLDM owns runtime graph mechanics:

- parsing Turtle;
- writing Turtle;
- holding multiple named graphs in one context;
- subject lookup across graphs;
- graph/fact provenance;
- graph-local mutation.

Exit criteria:

- opening a workspace creates or receives one OLDM context;
- every loaded Turtle resource becomes a graph in that context;
- source metadata stays in Solid Workspace, not in OLDM;
- app code reads through workspace collections or `context.subjects`, not through a
  second graph model.

## Step 5: keep workspace manifests in Solid Workspace

OLDM must remain vocabulary-agnostic. It should not know that any linked-data term
means "include this resource".

Workspace composition should therefore live in Solid Workspace, using a Turtle
manifest resource. The manifest describes a set of resources to load; it is not a
combined serialized graph.

Default behavior:

- recursive includes are enabled;
- cycles are detected and skipped;
- loaded resources are tracked independently;
- performance-sensitive callers can disable recursion.

Exit criteria:

- there is no `oldm.context.include()` that understands workspace vocabulary;
- Solid Workspace provides a manifest/include loader;
- launcher-style recursive screens/windows can be loaded by the same mechanism;
- launcher-specific terms remain interpreted by the launcher, not by Solid Workspace.

## Step 6: implement minimal single-user local/remote sync

For now, avoid a general CRDT. The near-term problem is one user with local and
remote versions of the same logical resource.

Use the smallest useful policy:

- stable subject IDs are never rewritten when a remote resource is attached;
- the local and remote stores both serialize as Turtle;
- additions are merged additively;
- deletes are represented by explicit tombstones;
- ordinary app-edited scalar fields use `dcterms:modified` and last-writer-wins;
- unknown, open-world, and multi-valued facts are unioned.

Exit criteria:

- offline edits can be saved locally;
- connecting a remote Solid resource does not change subject IDs;
- remote sync can merge additions and tombstones predictably;
- conflicting scalar updates have a deterministic policy;
- the design can later be replaced by m-ld or another RDF/JSON-LD CRDT without
  changing application object IDs.

## Step 7: shrink or replace graph-document merge APIs

Any public API that exposes "merge graph documents" as a separate conceptual model
should be removed, renamed, or made internal. The model is now resources, graphs, and
contexts.

Likely direction:

- parsing many Turtle resources returns many graphs in one context;
- workspace save/sync operates on resources and replicas;
- app collections are projections over the context;
- there is no canonical combined JSON document format.

Exit criteria:

- public docs do not teach a serialized workspace graph-document format;
- merge helpers are either internal implementation details or compatibility shims;
- app examples talk about Turtle resources and workspace manifests.

## Step 8: move collection convenience upward where possible

Solid Workspace can expose low-level collection views where they are useful for
source-aware graph work, but beginner/app-facing handles belong in SimplySolid.

Keep in Solid Workspace:

- source descriptors;
- workspace open/save/sync;
- context access;
- optional shape-filtered views over the working set.

Keep in SimplySolid:

- `app.solid`;
- named data handles;
- beginner-readable CRUD methods;
- setup/status conventions;
- validation before writes.

Exit criteria:

- Solid Workspace can be used without SimplyFlow or SimplySolid;
- SimplySolid can provide a friendly surface without reimplementing source mechanics;
- the API surface is smaller at both layers.

## Step 9: update JSFS-Solid after `solidApi`

JSFS-Solid should stay a filesystem-shaped adapter. It should depend on the Solid API
client, not on a distinct Metro-Solid concept.

It owns:

- path-to-resource mapping;
- file/folder operations;
- JSFS metadata mapping.

It delegates:

- Solid resource/container HTTP to `solidApi`;
- authentication to Metro-OIDC;
- parsing to Metro-OLDM/OLDM where configured.

Exit criteria:

- JSFS-Solid docs use `solidApi`;
- no Solid HTTP logic is duplicated inside JSFS-Solid;
- old Lading examples are removed or rewritten to use `solidApi`.

## What this gains

This refactor removes one conceptual layer and gives each remaining package a smaller
surface:

- Metro-Solid stops being a separate architecture concept.
- Solid HTTP becomes a Metro API helper.
- Solid Workspace no longer has to explain its own graph world.
- OLDM stays a parser/writer/context library without application vocabulary.
- SimplySolid gets a clearer role as app facade rather than data engine.
- Local and remote persistence use the same linked-data representation.

The result should be easier to explain as:

> Metro fetches. OLDM reads and writes RDF. Solid Workspace manages resources.
> SimplySolid makes that pleasant for apps.
