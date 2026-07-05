# @muze-labs/solid-workspace

Source-aware workspace and collection layer over Solid resources. It should stay independent from SimplyFlow.

Solid Workspace loads OLDMed data from Lading resource/container sources, keeps track of where objects came from, and exposes small collection handles for source-aware saves.

It does not authenticate, parse RDF, expose filesystem operations, or bind to SimplyFlow. Those concerns stay in Metro-OIDC, Metro-OLDM/OLDM, JSFS-Solid, and SimplySolid.

Docs:

- [Tutorial](docs/tutorial.md)
- [Reference](docs/reference.md)
