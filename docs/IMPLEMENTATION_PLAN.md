# Implementation plan

This repository starts from existing early `metro-solid` and `jsfs-solid` work and adds the package scaffolding needed for the SimplySolid runtime stack.

## Milestone 0 — repository scaffold

Status: **done in this scaffold**.

Deliverables:

- root npm workspace configuration;
- package shells for all planned runtime packages;
- existing `metro-solid` and `jsfs-solid` code preserved;
- stale unexported `SolidClient.js` removed from `jsfs-solid` because it contradicted the package boundary;
- examples workspace added;
- current design documents copied into `docs/DESIGN_NOTES`;
- package boundary and implementation-plan documents added;
- lightweight workspace/export check added.

## Milestone 1 — `metro.solidApi`

Goal: make Solid HTTP behavior a Metro-style API helper and remove Lading as a separate architecture layer.

Work:

- create a `@muze-labs/metro-solid` package that exports `solidApi`;
- port the useful Lading resource/container/profile/storage behavior into `solidApi`;
- keep resource/container/profile/storage concerns only;
- ensure 401/403 responses can be handled by callers when required by OIDC flows;
- add tests for safe reads/writes, ETag handling, container creation, profile discovery, and storage discovery;
- document Solid status/header behavior;
- remove the unreleased `@muze-labs/lading` package and update workspace callers.

Exit criteria:

- `solidApi(client)` works like the previous `lading(client)` helper;
- the former Lading tests pass against the new package;
- can discover storage from a WebID/profile;
- can read, write, patch, and delete a resource;
- can list and create a container;
- does not know about JSFS, OLDM shapes, SimplyFlow, or app setup.

## Milestone 2 — JSFS-Solid adapter review

Goal: make JSFS-Solid a thin adapter over the Solid-shaped Metro API helper.

Work:

- verify no app-level `solidClient` wrapper remains;
- add tests for path resolution, list mapping, read, write, mkdir, rmdir, and remove;
- decide whether this package should stay `@muze-labs/jsfs-solid` during the experiment or eventually replace an existing `@muze-nl/jsfs-solid` package;
- document default Metro composition separately from the adapter itself;
- migrate docs and examples from Lading to `solidApi`.

Exit criteria:

- no duplicated Solid HTTP logic;
- adapter delegates resource/container operations to `solidApi`;
- existing JSFS use cases remain possible.

## Milestone 3 — oldm-shape core

Goal: define the native linked-data contract model before SimplySolid collections depend on it.

Work:

- implement `shape()`;
- implement `shape.fragment()`;
- implement `field` helpers;
- implement cardinality checks;
- implement defaults where useful;
- implement validation diagnostics;
- implement shape satisfaction diagnostics;
- support OLDMed `$` names everywhere.

Exit criteria:

```js
ContactShape.validate(contact)
ContactShape.satisfies(PersonCardShape)
```

both work and return clear diagnostics.

## Milestone 4 — solid-workspace core

Goal: create the generic Solid/OLDM data layer.

Work:

- define resource and container source descriptors;
- load direct RDF resources from configured sources;
- track source URL per loaded object/fact;
- use one OLDM context for loaded graphs;
- load Turtle workspace manifests recursively without teaching OLDM workspace vocabulary;
- support read-only sources;
- implement `createIn` routing;
- implement collection views;
- implement `save()` with per-resource status;
- implement `saveAll()` that throws when any save fails.

Exit criteria:

- load contacts from a Solid container;
- create a new contact in the configured target resource/container;
- update and delete an existing contact;
- report save status per resource.

## Milestone 5 — SimplySolid MVP

Goal: connect the workspace/collection layer to SimplyFlow.

Work:

- implement `simplySolid(config)`;
- expose `app.solid`;
- create `app.solid.data.*` collection handles;
- expose app-facing Solid status;
- support `sync`, `list`, `get`, `create`, `update`, and `delete`;
- validate writes through oldm-shape;
- build a contacts example.

Exit criteria:

A beginner-readable app can load and render contacts through normal SimplyFlow bindings while Solid concerns stay inside `app.solid`.

## Milestone 6 — setup conventions

Goal: move beyond hardcoded paths.

Work:

- app storage conventions;
- app settings conventions;
- type-index-style registration if needed;
- setup-needed and repair-needed status;
- setup UI state exposed through app data, without SimplySolid becoming a UI framework.

## Milestone 7 — local-first workspace sources

Goal: make PWA-style applications work from local graph resources first, then sync with Solid resources when network and authorization are available.

Work:

- define generic Turtle-backed graph resource sources independent of Solid transport;
- add factory methods such as `graph.resource()`, `local.memory()`, `local.indexedDB()`, and `solid.turtleResource()`;
- add memory and IndexedDB-backed resource sources;
- store local resource payloads as Turtle and parse them into OLDM graphs at runtime;
- expose per-source availability status such as `ready`, `offline`, `auth-needed`, and `sync-pending`;
- let a workspace open and render from local sources while remote sources fail independently;
- support local-first writes that mark remote sync pending;
- sync a local source additively into a Solid resource when it becomes available;
- migrate margin-notes from manual local/remote merge coordination to workspace sources.

Exit criteria:

- a PWA app can create and edit data offline;
- reconnecting a Solid source syncs local changes without replacing the local dataset;
- remote source failures are visible as source status and do not make the workspace unusable;
- every resource source can expose Turtle as its serialized payload and an OLDM graph/context view at runtime;
- minimal single-user sync uses stable IDs, timestamps, tombstones, additive merge, and narrow last-writer-wins scalar updates.

## Milestone 8 — semantic templates

Goal: make linked-data-native reusable templates inspectable.

Work:

- implement `simplysolid-templates`;
- parse `data-simply-shape`;
- parse `data-simply-field`, `data-simply-edit`, and `data-simply-list`;
- produce field usage reports;
- compare template usage to oldm-shape fragments;
- add diagnostics.

## Milestone 9 — residential and SimplyCode integration support

This should mostly happen outside `solid-tools`, but `solid-tools` must preserve the boundaries that make it possible.

The runtime packages should not perform catalog search, component selection, app source generation, or local overlay discovery. Those responsibilities belong to SimplyCode and the explicit SimplyFlow overlay mechanism.
