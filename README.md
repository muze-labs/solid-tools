# Solid Tools

Solid Tools is the Muze Labs monorepo for the small Solid and linked-data runtime packages needed to implement SimplySolid.

This repository currently combines two kinds of work:

- early code for `metro-solid` and `jsfs-solid`;
- scaffolding for the remaining packages that will become the SimplySolid runtime stack.

Nothing in this repository is released yet, so package boundaries and APIs can still change freely while the design settles.

## Packages

```txt
packages/metro-solid
  Solid resource/container/profile/storage API helper for Metro clients.

packages/jsfs-solid
  JSFS adapter backed by Solid storage, implemented on top of metro-solid.

packages/solid-workspace
  Source-aware OLDMed working set over Solid resources and containers.

packages/simplysolid
  SimplyFlow extension exposing Solid workspaces and collections as app.solid.

packages/simplysolid-templates
  Semantic template inspection for data-simply-shape, field, edit, and list usage.
```

## Intended dependency direction

```txt
@muze-nl/metro
  generic HTTP client and middleware

@muze-nl/metro-oidc
  authentication/session middleware

@muze-nl/oldm + @muze-nl/metro-oldm
  linked-data parsing/writing and Metro integration

@muze-labs/oldm-shape
  linked-data shape contracts, maintained in the oldm monorepo

@muze-labs/metro-solid
  Solid resource/container/profile/storage operations over a configured Metro client

@muze-labs/solid-workspace
  source-aware working set over Solid resources

@muze-labs/simplysolid
  SimplyFlow runtime integration
```

`jsfs-solid` remains a useful adapter package, but SimplySolid should not depend on the filesystem abstraction unless a concrete feature needs it.

## Design notes

The current design documents are copied into [`docs/DESIGN_NOTES`](./docs/DESIGN_NOTES/). The implementation roadmap is in [`docs/IMPLEMENTATION_PLAN.md`](./docs/IMPLEMENTATION_PLAN.md), and package boundaries are summarized in [`docs/PACKAGE_BOUNDARIES.md`](./docs/PACKAGE_BOUNDARIES.md).

## Development

```bash
npm install
npm run build
npm test
```

The root `build` script performs a lightweight workspace/export sanity check. The actual package behavior will be implemented milestone by milestone.
