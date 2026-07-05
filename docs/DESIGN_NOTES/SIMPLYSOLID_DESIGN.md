# SimplySolid design

## Purpose

SimplySolid is a SimplyFlow extension for building Solid-backed web applications.

It should not become a separate application framework. SimplyFlow remains responsible for application structure, app data, actions, commands, routing, DOM binding, and component composition. SimplySolid adds Solid-specific runtime conventions and shape-backed data access.

SimplySolid should be small, explicit, and runtime-focused. Search, discovery, component matching, package import, rich verification, and code generation belong in SimplyCode.

## Stack

```txt
metro
  HTTP foundation.

metro-oidc
  Authentication/session middleware for Metro.

solid-tools / lading
  Solid resource/container/discovery helpers over Metro.

jsfs-solid
  JSFS adapter backed by Solid resources, built on lading.

OLDM
  Linked-data object model, parsing, and writing.

metro-oldm
  OLDMed linked-data documents over Metro.

oldm-shape
  Native linked-data shape model for OLDMed objects.

SimplyFlow
  Application/data/actions/commands/routing/DOM/component framework.

SimplySolid
  SimplyFlow extension for Solid workspaces, app data, collections, and shape-backed resources.
```

## Role of lading and jsfs-solid

`lading` is the Solid-shaped Metro layer. It knows about Solid resources, containers, headers, discovery, and safe writes. It does not expose a filesystem abstraction.

`jsfs-solid` is the JSFS adapter implemented on top of lading. It should not contain the old `solidClient` convenience layer. Applications and higher layers compose Metro, Metro-OIDC, Lading, JSFS-Solid, OLDM, and Metro-OLDM explicitly.

## Role of oldm-shape

`oldm-shape` is the native data-contract language for SimplySolid.

SHACL and ShEx are import/export formats, not the primary application authoring model.

SimplySolid declarations should use oldm-shape objects directly:

```js
solid: simplySolid({
  data: {
    contacts: {
      shape: ContactShape,
      path: 'contacts/'
    }
  }
})
```

`oldm-shape` should support:

- shapes and shape fragments
- OLDMed prefixed names such as `schema$Person` and `schema$name`
- field kinds such as string, iri, date, number, boolean, object, reference
- cardinality via `min`, `max`, and `many`
- validation
- defaults where useful
- shape satisfaction checks for component/data compatibility

Shape matching can be implemented as small deterministic operations in oldm-shape, but search and selection of matching packages/components belongs to SimplyCode.

## OLDMed names everywhere

SimplySolid authoring should use a single prefixed-name representation across HTML, JavaScript, shapes, and component metadata:

```txt
schema$Person
schema$name
foaf$knows
vcard$hasEmail
```

Do not require users to use `schema:name` in HTML and `schema$name` in JavaScript. Turtle/RDF export can explain that `$` maps to `:` in RDF syntax.

## SimplyFlow integration

SimplySolid should be a SimplyFlow extension object, not a new app constructor.

Conceptual shape:

```js
import { app } from '@muze-labs/simplyflow'
import { simplySolid } from '@muze-labs/simplysolid'

export const contactsApp = app({
  id: 'https://apps.muze.nl/contacts/',

  solid: simplySolid({
    data: {
      contacts: {
        shape: ContactShape,
        path: 'contacts/'
      }
    }
  }),

  actions: {
    async loadContacts() {
      await this.solid.data.contacts.sync()
    }
  }
})
```

SimplySolid should expose runtime services such as:

```txt
app.solid.status
app.solid.profile
app.solid.storage
app.solid.data.contacts
app.solid.settings
```

It may also expose status through `app.data.solid` so SimplyFlow bindings can render connection/setup/loading state.

## Components remain plain objects

SimplyFlow components are plain object structures. SimplySolid should not require component classes or factory functions.

Components may include Solid metadata, oldm-shape fragments, templates, styles, actions, commands, and optional descriptions, but they should remain inspectable object structures.

An optional helper can be added later if it improves authoring, but the canonical model should stay plain object components.

## Application data and components

Components do not own application data. They should not define `component.data`.

Components that need to initialize application data should use a start hook or provide explicit initialization actions.

Example:

```js
export const contacts = {
  name: 'contacts',

  start() {
    this.data.contacts ??= []
    this.data.selectedContact ??= null
  },

  actions: {
    async loadContacts() {
      this.data.contacts = await this.solid.data.contacts.list()
    }
  }
}
```

Rendering follows automatically from app data changes.

This matters for residential programming: live component overlays should update functions, templates, styles, transformers, API methods, and other code/presentation surfaces first. App data should be altered later through hooks/actions if needed.

## Shape-backed collections

A SimplySolid collection connects an oldm-shape to a Solid resource/container location.

Example handle:

```js
await this.solid.data.contacts.list()
await this.solid.data.contacts.sync()
await this.solid.data.contacts.get(id)
await this.solid.data.contacts.create(data)
await this.solid.data.contacts.update(id, data)
await this.solid.data.contacts.delete(id)
```

Responsibilities:

- discover storage through lading
- resolve collection paths relative to storage
- read linked data through metro-oldm/OLDM
- validate before writing through oldm-shape
- write resources through lading/metro-oldm
- expose collection status/errors to SimplyFlow app data

## What SimplySolid should not do

SimplySolid should not own:

- authentication implementation — use metro-oidc
- low-level Solid HTTP semantics — use lading
- filesystem API — use jsfs/jsfs-solid
- Turtle/RDF parsing/writing — use OLDM/metro-oldm
- component search/matching — use SimplyCode
- package import — use SimplyCode
- SHACL/ShEx as the primary data model — use oldm-shape with adapters
- public mod catalogs — future residential/SimplyCode work

## Runtime versus design-time responsibilities

SimplySolid consumes explicit declarations at runtime.

SimplyCode can discover, recommend, verify, and generate those declarations.

Residential programming may live-patch public SimplyFlow component objects at runtime, but this is a separate optional capability. SimplySolid should remain patch-friendly by keeping declarations explicit and app identity stable.

## App identity

Apps that use SimplySolid should have a stable app identity.

For normal standalone apps, this can default to the application URL without the hash/fragment. Applications with complex URL strategies, such as SPAs/PWAs that manipulate the URL directly, should define an explicit stable `app.id`.

This is especially useful for:

- Solid application setup
- browser-local residential overlays
- future mod lookup
- user-owned app settings and registrations

## Future setup and registration milestones

The first SimplySolid core should support shape-backed collections. Later milestones can add:

- app settings conventions
- app storage conventions
- type-index-style registration
- SAI-inspired access needs
- setup/repair state
- migrations
- SHACL/ShEx import/export through oldm-shape adapters

## Roadmap

### Milestone 1 — solid-tools cleanup

- remove old `solidClient` from jsfs-solid
- keep lading as Solid resource/container layer
- make jsfs-solid depend on lading

### Milestone 2 — oldm-shape core

- OLDMed `$` names
- shape fragments
- cardinality and validation
- shape satisfaction diagnostics

### Milestone 3 — SimplySolid core

- SimplyFlow extension
- app.solid service
- shape-backed Solid collections
- storage discovery
- list/create/update/delete/sync

### Milestone 4 — setup conventions

- app settings
- app storage
- type registrations
- setup/repair UI state

### Milestone 5 — semantic templates/components

- template shape discovery
- component contracts
- package metadata
- SimplyCode matching

### Milestone 6 — richer interop

- SHACL/ShEx adapters
- SAI-inspired access needs
- stronger registration/access grant compatibility
