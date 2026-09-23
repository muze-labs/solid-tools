# @muze-labs/simplysolid

SimplyFlow runtime extension that exposes Solid collections through `app.solid`.

Milestone status: Milestone 8 local-first resource facade is in progress.

SimplySolid creates app-facing collection handles, setup status, and workspace dataset/sync helpers on top of Solid Workspace. It can now start from local-first logical resources backed by IndexedDB, then attach Solid replicas later with `connect()`. It keeps Solid concerns inside `app.solid`, while Metro-Solid, Metro-OLDM/OLDM, and oldm-shape keep their own lower-level responsibilities.

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
