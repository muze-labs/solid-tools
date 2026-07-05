# SimplyCode design

## Purpose

SimplyCode is a recipe-driven IDE for building software from vertical slices.

It is not a general-purpose code editor in the usual sense. Its primary unit is a feature slice: a user-visible piece of functionality with its template, style, commands, actions, API methods, transformers, shapes, mock data, tests, and metadata kept close together.

SimplyCode should help technically curious non-professional programmers build understandable web software by making the structure of a project visible and editable without hiding the underlying web standards. It should also remain useful to professional programmers by keeping the generated/runtime code ordinary, inspectable, and replaceable.

## What SimplyCode is not

SimplyCode is not the runtime framework.

- SimplyFlow runs the application.
- SimplySolid connects SimplyFlow applications to Solid, oldm-shape, and Solid resources.
- oldm-shape describes linked-data-native data contracts.
- SimplyCode helps author, discover, verify, assemble, build, and publish those pieces.

SimplyCode may perform sophisticated search, matching, diagnostics, and code generation, but these responsibilities should not be pushed down into the runtime libraries.

## Core idea: vertical slices

A vertical slice is an identifiable user-facing feature. A slice is more than a visual component. It may contain:

- HTML templates
- CSS rules
- SimplyFlow commands
- SimplyFlow actions
- API methods
- transformers
- oldm-shape declarations or shape fragments
- SimplySolid collection/use declarations
- mock data
- examples and tests
- documentation
- Turtle metadata for discovery and reuse

Examples:

- `ContactCard`
- `ContactEditor`
- `CourseProgressOverview`
- `SchoolLogoUploader`
- `StudentExerciseResultList`

The important reusable unit is often:

```txt
HTML + CSS + behavior + data shape + storage convention + metadata
```

not just a DOM fragment.

## Recipes

A SimplyCode recipe defines how a particular kind of deliverable is understood, edited, built, verified, reused, assembled, and published.

A recipe should define:

1. The deliverable model: app, website, design system, package, tutorial, etc.
2. Project organization: the high-level sections that appear in the IDE.
3. Feature component structure: the sections that make up a vertical slice.
4. Assembly rules: how slices become pages, routes, builders, and final output.
5. Build pipeline: how the deliverable is turned into runnable output.
6. Publish pipeline: how the output is deployed, packaged, or cataloged.
7. External resources: where to search for components, packages, APIs, shapes, assets, examples, and metadata.
8. Import rules: how found resources are installed, copied, forked, adapted, or referenced.
9. Verification rules: which checks run before preview, build, or publish.
10. Preview and test behavior: how an isolated slice is rendered, mocked, validated, and tested.

A recipe is not just a project template. It is a project grammar and authoring environment definition.

## Application recipe organization

For a SimplyFlow/SimplySolid application, the high-level organization should be recipe-defined. The current application direction uses:

- **base components** — small reusable building blocks available across the app.
- **components** — vertical-slice feature components.
- **pages** — full visual pages that own layout, route definitions, and placement of feature components.
- **builders** — higher-level assembly/generation units for app shell, navigation, routes, indexes, output, and metadata.

These categories should not be hardcoded into SimplyCode. They belong in the application recipe. A website recipe, design-system recipe, or tutorial recipe may define different sections.

## Feature component sections

For an application recipe, a feature component may be divided into sections such as:

- `template` — HTML / SimplyFlow template.
- `style` — CSS scoped to the component or feature.
- `commands` — UI-triggered SimplyFlow commands.
- `actions` — behavior called by commands, hooks, or other components.
- `api` — external/backend API methods used by the slice.
- `transformers` — presentation/data transformation functions.
- `solid` — Solid collections, resource handles, access needs, and related app-data declarations.
- `shapes` — oldm-shape declarations or fragments.
- `mock` — mock data and services for preview.
- `tests` — slice-local unit tests and examples.
- `docs` — human-readable documentation.
- `metadata` — Turtle metadata for package/component discovery.

The recipe decides which sections are required, optional, generated, hidden, or advanced.

## Pages own routes

Routes belong to pages, not nested feature components.

A page is usually a full visual page, even inside an SPA. It knows:

- page layout
- which feature components appear where
- route definitions and route behavior
- page-level data loading or route-to-data mapping

Feature components may expose inputs, events, commands, or actions, but they should not define application routes. Allowing route functions to be spread across nested components makes URL behavior difficult to reason about.

Example:

```txt
ContactList
  knows how to list contacts.

ContactEditor
  knows how to edit one contact.

ContactsPage
  places ContactList and ContactEditor and owns:
  - /contacts
  - /contacts/:contactId
```

Recipe rule:

```txt
Application recipes may allow routes only in page sections.
```

## Live slice preview

SimplyCode should show live previews of the slice currently being edited.

A slice preview is a complete working slice, not a static screenshot. It includes:

- the HTML template
- CSS
- SimplyFlow bindings
- commands/actions used by the slice
- mock data
- mock services/API responses
- mock Solid collections where needed
- transformers
- shape validation where relevant

The preview should use the same runtime rules as the final app, but with a controlled mock context.

Example mock data:

```js
export const mock = {
  data: {
    contact: {
      schema$name: 'Ada Lovelace',
      schema$image: '/mock/ada.png',
      schema$email: 'ada@example.org'
    }
  }
}
```

## Validation while editing

SimplyCode validates while the user edits.

HTML diagnostics may include:

- invalid or suspicious HTML
- unknown `data-simply-*` attributes
- missing template references
- template fields missing from mock data
- template fields missing from oldm-shape declarations
- invalid `data-simply-list` / `<template rel="...">` structures
- accessibility warnings

JavaScript diagnostics may include:

- syntax errors while typing
- missing exports expected by the recipe
- commands referenced by templates but not implemented
- actions defined but never used
- API methods without mocks
- transformers referenced by templates but missing
- unit tests failing for a specific slice section

Linked-data diagnostics may include:

- invalid OLDMed prefixed names
- unknown prefixes
- shape fields used by a template but missing from an oldm-shape
- mock data that violates a shape
- component metadata out of sync with template/shape declarations

## Tests per slice section

Each JavaScript part of a vertical slice may contain its own unit tests.

Examples:

- `actions.test.mjs`
- `commands.test.mjs`
- `api.test.mjs`
- `transformers.test.mjs`
- `shape.test.mjs`
- `template.test.mjs`

The recipe decides which tests apply to which section.

Tests should be shown near the code they validate. A feature component might show:

```txt
ContactEditor
  Template: valid
  CSS: valid
  Actions: 3 tests passing
  API: mock missing for saveContact
  Shape: mock contact violates schema$email cardinality
```

## External resources and imports

Recipes define the outside resources and APIs SimplyCode may use:

- Turtle component catalogs
- npm/package registries
- shape catalogs
- API catalogs
- asset libraries
- design-token libraries
- project-local reusable components

Import modes may include:

- `install` — add a package dependency.
- `copy` — copy source into the project.
- `fork` — copy source with local ownership and preserved metadata.
- `reference` — use a remote/package resource without copying.
- `adapt` — generate a wrapper or mapping layer to fit the local project.

This generalizes behavior that may currently be hardcoded in a prototype.

## Semantic search, matching, and verification

Semantic search and component matching belong in SimplyCode, not in SimplySolid.

SimplyCode can ask:

- Which components can render data shaped as `schema$Person`?
- Which components can edit this oldm-shape fragment?
- Which package provides a component that matches my app’s data structure?
- What fields are missing before this component can be reused?
- Which pages can host this feature component?

The runtime receives explicit wiring. The IDE performs discovery, matching, explanations, and code generation.

## Turtle-first package metadata

Package/component metadata should be data, not executable JavaScript.

Turtle is the preferred canonical metadata format. JSON or JSON-LD may be generated for compatibility, but Turtle keeps component/package discovery linked-data-native.

Suggested package layout:

```txt
person-components/
  package.json
  package.ttl
  src/
    person-card.mjs
    person-card.html
    person-editor.mjs
    person-editor.html
    shapes.mjs
```

`package.json` may point to the metadata:

```json
{
  "name": "@muze-labs/person-components",
  "version": "0.1.0",
  "exports": "./src/index.mjs",
  "simply": {
    "metadata": "./package.ttl"
  }
}
```

Example Turtle metadata:

```turtle
@prefix simply: <https://simplyflow.dev/ns#> .
@prefix solid: <https://simplysolid.dev/ns#> .
@prefix schema: <https://schema.org/> .
@prefix this: <./> .

this:
  a simply:Package ;
  schema:name "@muze-labs/person-components" ;
  schema:version "0.1.0" ;
  simply:providesComponent this:PersonCard .

this:PersonCard
  a simply:Component ;
  schema:name "PersonCard" ;
  simply:template <src/person-card.html> ;
  simply:module <src/person-card.mjs> ;
  solid:mode solid:View ;
  solid:requiresShape this:PersonCardShape .

this:PersonCardShape
  a solid:ShapeFragment ;
  solid:targetClass schema:Person ;
  solid:requiresField schema:name, schema:image .
```

## Relationship to residential programming

SimplyCode is the full external IDE. Residential programming is an optional in-app editing capability.

They share concepts:

- vertical-slice components
- recipes
- editable surfaces
- live previews
- component metadata
- local tests and validation

But their interaction style differs:

- SimplyCode edits the project from the outside and can perform rich design-time search, matching, verification, build, and publish flows.
- Residential programming lets a running app expose its public component objects for live in-app editing through browser-local overlays.

SimplyCode should eventually be able to inspect residential overlays, turn them into source changes, export them, or publish them as mods. That is future work.

## Roadmap

### Milestone 1 — Recipe model

Define a minimal recipe format for SimplyFlow/SimplySolid applications:

- deliverable type
- high-level organization
- feature component sections
- page sections
- builder sections
- preview/test rules
- build/publish commands

### Milestone 2 — Slice editor

Support editing a vertical slice:

- template
- style
- commands/actions
- mock data
- local tests
- live preview

### Milestone 3 — Semantic metadata

Generate and consume Turtle package/component metadata.

### Milestone 4 — Component search and import

Search local and remote catalogs for reusable components, packages, shapes, APIs, and templates.

### Milestone 5 — Assembly

Assemble feature components into pages, page routes, builders, and publishable output.

### Milestone 6 — Residential integration

Inspect local residential overlays, convert useful changes back into project source, and package selected changes as reusable mods.
