# @muze-labs/solid-workspace

Source-aware workspace and collection layer over OLDMed graph resources. It should stay independent from SimplyFlow.

Local-first logical resources are implemented with native OLDM working graphs,
Turtle persistence, and explicit replica sync. Cross-tab ordering and conditional
remote writes remain outside the current contract.

Solid Workspace loads OLDMed data from local and Solid resource/container sources, keeps track of where objects came from, exposes small collection handles for source-aware saves, and loads resource graphs into one OLDM context.

The design is local-first: PWA-style apps should be able to open local graph resources, keep working offline, and sync with Solid resources when network and authorization return.

The first local source factories are `local.memory()` and `local.indexedDB()`. `resource(id, { local, remote })` groups local and Solid replicas as one app-facing logical resource. `graph.resource()` exposes the lower-level source contract for custom storage adapters, and `solid.resource()` names Solid resources. `workspace.add()` composes one factory-created workspace part or an array of parts and returns the same workspace for chaining.

`workspace.open('notes')`, `workspace.graph('notes')`, `workspace.createIn('notes', object)`, and `workspace.sync('notes')` are the intended local-first path. `workspace.open()` is tolerant by default: remote source failures become source status while local sources keep the app usable. `workspace.load()` remains strict for lower-level callers.

It does not authenticate, parse RDF, expose filesystem operations, or bind to SimplyFlow. Those concerns stay in Metro-OIDC, Metro-OLDM/OLDM, JSFS-Solid, and SimplySolid.

Docs:

- [Tutorial](docs/tutorial.md)
- [Reference](docs/reference.md)

## RDF values

Property names remain prefixed, such as `schema$name`. Class values in `a` and
literal datatypes in `.type` are full IRIs. Use full IRIs in plain-object data and
collection shape targets, for example `shape('https://schema.org/Person', {...})`.
Expand a prefixed constant once with its OLDM context before using it in filters.
The workspace preserves HTTP/HTTPS namespace identity and does not rewrite
application vocabulary. OLDM graph write helpers still accept
prefixed inputs where documented.

Editable logical resources can declare `scalarPredicates` as full predicate IRIs.
Their sync uses modification timestamps and `lm:deleted` on deleted subjects, commits locally
before writing remotely, and protects newer admitted saves from stale snapshots.
See [Replica save contract](../../docs/DESIGN_NOTES/REPLICA_SAVE_CONTRACT.md) for
behavior, evidence, and the limits on cross-tab and remote concurrency.

## Working graphs and snapshots

`ws.context` is the live OLDM context; pass `context` to `workspace()` to supply
one. `ws.graph(sourceId)` returns a source graph, and `ws.graph(resourceId)`
returns the local working graph when available. Collections return those same
source-owned nodes. OLDM owns RDF identity, graph lookup, and fact provenance;
Solid Workspace owns resource metadata and persistence.

Saving a subject writes its whole source graph. Storage adapters exchange Turtle;
there is no graph-document format or migration API. After a successful
reload or replica sync, read fresh nodes from the graph or collection before
editing. Stale nodes are rejected by `save()`.

## Implementation structure

`workspace.mjs` composes the source registry, working graph owner, storage I/O,
write lifecycle, replica lifecycle, shared operation queue, and status owner.
The boundaries and their ordering contracts are described in the
[refactor guide](../../docs/DESIGN_NOTES/SOLID_TOOLS_REFACTOR_GUIDE.md#implementation-boundaries--2026-10-30).

## Edit ownership

`ownedPredicates` declares full predicate IRIs whose named targets belong to the
same edit as their root subject. Only the root needs `dcterms:modified`; its
revision selects declared scalars throughout the group. Equal timestamps select
one entire group revision deterministically, with deletion winning a tie.
Unknown facts remain additive. Ownership links are not automatically scalar:
include them in `scalarPredicates` too if edits can replace or remove those links.
Nested ownership is supported; multiple owners and cycles are rejected, including
conflicts across replicas. Shared references must not be declared as ownership.
This policy does not delete linked subjects or prune unreferenced snapshots.

Graph merging retains non-conflicting prefix declarations from every source.
For a reused prefix label, the first source's mapping wins; imported facts keep
their full IRI meaning. Writers omit declarations unused by the merged output.
