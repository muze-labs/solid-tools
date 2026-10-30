# @muze-labs/solid-workspace

Source-aware workspace and collection layer over OLDMed graph resources. It should stay independent from SimplyFlow.

Milestone status: Milestone 6 local-first logical resources are in progress.

Solid Workspace loads OLDMed data from local and Solid resource/container sources, keeps track of where objects came from, exposes small collection handles for source-aware saves, and can view multiple resources as one open-world graph dataset.

The long-term design is local-first: PWA-style apps should be able to open local graph resources, keep working offline, and sync with Solid resources when network and authorization return.

The first local source factories are `local.memory()` and `local.indexedDB()`. `resource(id, { local, remote })` groups local and Solid replicas as one app-facing logical resource. `graph.resource()` exposes the lower-level source contract for custom storage adapters, and `solid.resource()` names Solid resources. `workspace.add()` composes one factory-created workspace part or an array of parts and returns the same workspace for chaining.

`workspace.open('notes')`, `workspace.dataset('notes')`, `workspace.createIn('notes', object)`, and `workspace.sync('notes')` are the intended local-first path. `workspace.open()` is tolerant by default: remote source failures become source status while local sources keep the app usable. `workspace.load()` remains strict for lower-level callers.

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
application-owned legacy documents. OLDM graph write helpers still accept
prefixed inputs where documented.

Editable logical resources can declare `scalarPredicates` as full predicate IRIs.
Their sync uses modification timestamps and `lm:deleted` on deleted subjects, commits locally
before writing remotely, and protects newer admitted saves from stale snapshots.
See [Replica save contract](../../docs/DESIGN_NOTES/REPLICA_SAVE_CONTRACT.md) for
behavior, evidence, and the limits on cross-tab and remote concurrency.
