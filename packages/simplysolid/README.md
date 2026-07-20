# @muze-labs/simplysolid

SimplyFlow runtime extension that exposes Solid collections through `app.solid`.

Milestone status: Milestone 7 workspace dataset and resource sync facade are implemented.

SimplySolid creates app-facing collection handles, setup status, and workspace dataset/sync helpers on top of Solid Workspace. It keeps Solid concerns inside `app.solid`, while Lading, Metro-OLDM/OLDM, and oldm-shape keep their own lower-level responsibilities.

Docs:

- [Tutorial](docs/tutorial.md)
- [Reference](docs/reference.md)
