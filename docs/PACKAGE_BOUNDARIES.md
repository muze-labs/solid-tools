# Package boundaries

This repository contains the Solid and linked-data runtime packages needed for SimplySolid. It should not absorb generic Muze libraries or design-time application tooling.

## Outside this repository

These stable packages stay outside `solid-tools`:

- `@muze-nl/metro`: generic HTTP client and middleware.
- `@muze-nl/metro-oidc`: authentication/session middleware.
- `@muze-nl/oldm`: object linked data mapper.
- `@muze-nl/metro-oldm`: Metro/OLDM middleware.
- `@muze-labs/simplyflow`: UI/runtime app layer.
- SimplyCode: design-time search, matching, code generation, editing, and catalog tooling.

The exception is `@muze-labs/metro-solid`: it can start in this repository while the
old Lading package is superseded, but its intended stable home is the Metro family as
`@muze-nl/metro-solid` / `metro.solidApi`.

## `@muze-labs/metro-solid`

Metro-Solid is the Solid-shaped Metro API helper. It knows about Solid resources, containers, headers, profile discovery, storage discovery, and safe reads/writes.

Metro-Solid does **not** implement authentication, RDF parsing, OLDM object mapping, JSFS, SimplyFlow integration, app conventions, local-first sync, or residential programming.

It accepts a base URL or configured Metro client. If that Metro client uses `metro-oidc`, requests may authenticate. Metro-Solid adds `metro-oldm` automatically so profile and container helpers can consume parsed linked data.

The initial package in this repository may use the `@muze-labs/metro-solid` name. The intended stable form is a Metro companion package that can be re-exported as `metro.solidApi`, similar to `metro.jsonApi`.

## `@muze-labs/jsfs-solid`

JSFS-Solid presents Solid storage as a JSFS filesystem adapter. It is implemented on top of the Solid-shaped Metro API helper.

It owns file-system-shaped operations such as:

- `read`
- `write`
- `list`
- `mkdir`
- `rmdir`
- `remove`

It may compose Metro-OIDC and Metro-OLDM when constructing a default adapter client, but those concerns remain separate libraries. It must not export an application-level `solidClient`; application setup belongs in SimplySolid.

## `@muze-labs/oldm-shape`

OLDM Shape is the native linked-data contract package. It owns:

- OLDMed `$` names in shape definitions;
- shape declarations and fragments;
- field declarations;
- cardinality constraints;
- defaults where useful;
- validation diagnostics;
- shape satisfaction checks.

It does not choose UI components, load Solid resources, or generate app code.

## `@muze-labs/solid-workspace`

Solid Workspace owns source-aware linked-data working sets over local and remote Turtle resources loaded into one OLDM context. Solid resources and containers are important source types, but the workspace must also support PWA/offline sources such as IndexedDB and memory-backed resources. It owns:

- generic graph resource source descriptors;
- Solid resource/container source descriptors;
- loading RDF resources through `solidApi`/Metro/OLDM;
- loading local Turtle graph resources without network access;
- tracking which data came from which source;
- per-source availability and sync-pending status;
- collection views over a workspace;
- `createIn` routing;
- local-first writes where configured by the application;
- minimal single-user source-to-source sync;
- recursive Turtle workspace manifest loading;
- read-only source handling;
- `save()` and `saveAll()` semantics.

It does not know about SimplyFlow bindings, commands, components, templates, or launcher-specific shortcut/window vocabulary.

## `@muze-labs/simplysolid`

SimplySolid is the SimplyFlow runtime extension. It owns:

- `app.solid`;
- shape-backed collection handles under `app.solid.data.*`;
- local and Solid workspace source setup for applications;
- Solid profile/storage/setup status exposed to the app;
- PWA-friendly workspace status exposed to the app;
- validation before writes;
- small runtime conventions needed by beginner apps.

It does not authenticate users itself, parse Turtle itself, expose a filesystem API, search for reusable components, generate source code, or silently read local overlays. It should make offline-capable app setup easy, but the low-level source and sync mechanics belong in Solid Workspace.

## `@muze-labs/simplysolid-templates`

SimplySolid Templates owns semantic inspection of SimplyFlow templates that use linked-data attributes. It owns:

- reading `data-simply-shape`;
- reading `data-simply-field`;
- reading `data-simply-edit`;
- reading `data-simply-list`;
- collecting OLDMed terms;
- comparing template usage to oldm-shape fragments.

It does not search component catalogs or decide which component should be used. That belongs in SimplyCode.
