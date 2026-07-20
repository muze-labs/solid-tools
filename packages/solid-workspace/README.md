# @muze-labs/solid-workspace

Source-aware workspace and collection layer over OLDMed graph resources. It should stay independent from SimplyFlow.

Milestone status: Milestone 5 workspace dataset and additive resource sync are implemented.

Solid Workspace loads OLDMed data from local and Solid resource/container sources, keeps track of where objects came from, exposes small collection handles for source-aware saves, and can view multiple resources as one open-world graph dataset.

The long-term design is local-first: PWA-style apps should be able to open local graph resources, keep working offline, and sync with Solid resources when network and authorization return.

The first local source factory is `local.memory()`. `graph.resource()` exposes the lower-level source contract for custom storage adapters, and `solid.turtleResource()` names Solid Turtle resources explicitly for source-to-source sync.

It does not authenticate, parse RDF, expose filesystem operations, or bind to SimplyFlow. Those concerns stay in Metro-OIDC, Metro-OLDM/OLDM, JSFS-Solid, and SimplySolid.

Docs:

- [Tutorial](docs/tutorial.md)
- [Reference](docs/reference.md)
