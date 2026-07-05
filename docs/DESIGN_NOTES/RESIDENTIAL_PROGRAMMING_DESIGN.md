# Residential programming design

## Purpose

Residential programming means that an application can expose selected parts of its own code and structure for live inspection and modification from inside the running application itself.

For Muze/SimplyFlow, the target is deliberately direct:

```txt
Edit the running program.
Apply changes immediately.
Store changes locally in the browser by default.
Recover through reload/replay, undo, rollback, and reset.
```

This should feel closer to Lisp-style live programming than to a safe draft-and-publish workflow. The application is the live environment; the editor is a code browser/editor attached to it.

Residential programming is optional. Not every SimplyFlow application needs to support it.

## Relationship to the stack

```txt
SimplyFlow
  Provides the application/component structure that makes residential programming possible.

SimplySolid
  Provides Solid app/data conventions when the app uses Solid.

SimplyCode
  External recipe-driven IDE for authoring vertical slices and projects.

Residential programming
  Optional in-app live editing of public SimplyFlow component objects through local overlays.
```

SimplyCode is the full external IDE. Residential programming is a lightweight in-app live editing capability built on the same component/slice ideas.

## Design principle

Residential programming is based on public component objects.

```txt
If it is public on the component object, it can be inspected and edited.
If it is private module scope, it is not automatically residential.
```

Components should remain plain object structures. The live editor browses `app.components` and edits public properties.

## App eligibility

A SimplyFlow application can support residential programming when:

1. It has a stable app id.
2. It runs from a stable browser origin.
3. It is not merely an embedded anonymous app inside an arbitrary host page.
4. It exposes its merged component registry through `app.components`.
5. It loads browser-local overlays before the normal component merge/start process.
6. It provides an explicit editor entry point.

Default app id:

```txt
location.href without the hash/fragment
```

Applications with complex URL strategies, such as SPAs/PWAs that manipulate the URL directly, should define an explicit stable `app.id`.

```js
export const app = simply.app({
  id: 'https://apps.muze.nl/contacts/',
  ...
})
```

Browser-local overlays are effectively scoped by:

```txt
browser storage origin + app id
```

If the same app id is served from a different domain, it will not see the overlays stored under the first origin. Cross-origin reuse requires explicit export, Solid-backed storage, or future mod/publishing support.

## Embedded apps

SimplyFlow supports applications that can be embedded in arbitrary pages, and even multiple apps in a single page.

Residential live editing should not initially support those apps unless they define a stable, unique app id and have a reliable storage/replay strategy.

Without stable identity, there is no clear way to decide:

- which app local overlays belong to
- when to replay them
- how to avoid component-name collisions
- how to recover changes after reload

This may be loosened later after a more robust storage layer for custom changes is designed.

## Component eligibility

A component can be residentially edited when:

1. It is present in `app.components`.
2. It has a unique app-wide name.
3. Its editable parts are public properties on the component object.
4. It does not define `component.data`.
5. Its functions can be reconstructed with `Function.prototype.toString()`.
6. Non-global dependencies needed by editable functions are exposed through `component.scope`.

Components may optionally define a human-readable `description`:

```js
export const contacts = {
  name: 'contacts',
  description: 'Shows the contact list and lets the user select a contact.',
  ...
}
```

The residential editor should show descriptions in the component list/detail view.

## Components do not own data

Components should not define `component.data`.

Application data lives on the app. Components that need data should initialize or alter app data through start hooks or explicit actions.

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

When applying a live overlay, update functions/templates/styles first. Data changes, if any, happen later through hooks/actions. Rendering follows automatically from app data changes.

## Component registry

SimplyFlow components are combined into the app, but remain visible through `app.components`.

Each component can include other components. Included components are also visible directly from the app-wide `app.components` set. This gives the residential editor two views of the live component system:

- a flat app-wide component registry
- a component inclusion/dependency structure

Every component must have a unique app-wide name.

## Overlay model

Residential changes are represented as component overlays.

To alter a component, create a component with the same `name`.

```txt
same component name = override
new component name = add component
```

An overlay may be partial. It stores only what was changed in that save. Anything not redeclared continues to come from the previously active component through the normal merge/composition behavior.

Example overlay:

```js
export const contacts = {
  name: 'contacts',

  template: `
    <section class="compact-contacts">
      <h1>Contacts</h1>
      ${this.components.contacts.template}
    </section>
  `
}
```

Inside a same-name overlay, `this.components.<sameName>` refers to the previous active implementation of that component.

For example, an overlay named `contacts` can call:

```js
this.components.contacts.actions.save.call(this, contact)
```

To reuse or wrap the previous active `contacts` implementation.

After applying the overlay:

```txt
app.components.contacts
  points to the active overlay/merged component.
```

## Multiple overlays

Residential programming assumes a single current-user/developer model.

Multiple overlays on the same component should be rare. When they occur, later overlays override earlier overlays.

The likely case is:

```txt
base app
  → installed external mod
  → local user overlay
```

The active component is the result of that linear overlay chain.

## Adding new components and parts

Residential editing is not limited to overriding existing things.

The editor may add:

- entirely new components
- new templates
- new styles
- new actions
- new commands
- new transformers
- new API methods
- new scope values where serializable/appropriate

If an overlay component has a new name, it extends `app.components`.

If it has an existing name, it overrides/adds public properties on the active component.

A newly added component becomes visible only when some page/component template includes it through normal SimplyFlow template inclusion:

```html
<simply-render rel="contactSearch"></simply-render>
```

or:

```html
<ul data-simply-list="contacts">
  <template rel="contactCard"></template>
</ul>
```

## Local overlay format

Browser-local overlays are stored as component-shaped records.

Example:

```js
{
  id: 'local-001',
  app: 'https://apps.muze.nl/contacts/',
  createdAt: '2026-07-05T09:30:00.000Z',
  label: 'Changed contacts template',
  enabled: true,

  component: {
    name: 'contacts',
    template: `<section class="compact-contacts">...</section>`
  }
}
```

Functions cannot be stored directly, so they are encoded as source strings:

```js
{
  id: 'local-002',
  app: 'https://apps.muze.nl/contacts/',
  createdAt: '2026-07-05T09:35:00.000Z',
  label: 'Changed contacts actions.save',
  enabled: true,

  component: {
    name: 'contacts',
    actions: {
      save: {
        $function: `async function save(contact) {
          contact.schema$dateModified = new Date().toISOString()
          return this.components.contacts.actions.save.call(this, contact)
        }`
      }
    }
  }
}
```

The first version should serialize:

- strings
- numbers
- booleans
- null
- arrays
- plain objects
- functions as `{ $function: source }`

Unsupported values such as DOM nodes, class instances, cyclic objects, Promises, proxies, and module namespace objects should not be saved in overlays.

## Function editing

Residentially editable apps must ship readable, unminified source.

Functions are edited by:

1. reading the current function source through `Function.prototype.toString()`
2. showing the source in the editor
3. compiling the edited source with the `Function` constructor
4. replacing the public function property on the component/app structure
5. storing the function source in the local overlay record

Residential programming supports normal dynamically-bound JavaScript functions:

```js
function save(contact) { ... }
async function save(contact) { ... }
save(contact) { ... }
async save(contact) { ... }
```

Arrow functions are not supported for editable SimplyFlow behavior because they capture `this` lexically, while SimplyFlow binds `this` when functions are used.

Method shorthand and named function declarations are equivalent for SimplyFlow’s binding purposes. Stored overlays may normalize function sources to named function declarations.

## Function scope

Editable functions may use imports or helper values if the component exposes those values through `component.scope`.

Example:

```js
import { normalizeContact } from './contact-utils.mjs'
import { validateEmail } from './validators.mjs'

export const contacts = {
  name: 'contacts',

  scope: {
    normalizeContact,
    validateEmail
  },

  actions: {
    save(contact) {
      const normalized = normalizeContact(contact)
      if (!validateEmail(normalized.schema$email)) {
        throw new Error('Invalid email')
      }
      return this.solid.data.contacts.update(contact['@id'], normalized)
    }
  }
}
```

When recompiling an edited function, the editor uses the active component’s public `scope` as the named execution context.

Hidden module locals are not residential unless exposed through `scope`.

## Dynamic compilation and CSP

Residential programming requires dynamic function compilation.

The proof of concept can use the `Function` constructor:

```js
function compileResidentialFunction(source, scope = {}) {
  const names = Object.keys(scope)
  const values = Object.values(scope)

  return Function(
    ...names,
    `"use strict"; return (${source});`
  )(...values)
}
```

Apps with strict CSP settings that forbid eval-like behavior cannot support editable JavaScript functions in the first version. They may still support template/style-only residential editing.

## Application startup/replay

Overlays are applied by the application itself, not only when the editor is loaded.

Startup flow:

```txt
1. Load the base app.
2. Determine app id.
3. Load enabled browser-local overlays for app id.
4. Add/replay overlay components into app.components.
5. Run the normal SimplyFlow component merge/start process.
```

The editor always starts from the current already-overlaid app state.

## Live overlay application

After startup, a new overlay is applied live by:

1. Saving the overlay record locally.
2. Reconstructing the overlay component.
3. Replacing or adding `app.components.<name>`.
4. Overwriting app properties directly defined by the overlay.
5. Running explicit live side effects for changed sections.

Components added later overwrite same-name app properties.

## Live side effects

### Templates

Each template has an app-wide unique DOM id:

```html
<template id="contacts">
```

Rendered roots should be marked with:

```html
<section data-simply-template="contacts">
```

A live template update:

1. updates/replaces `<template id="contacts">`
2. finds affected roots with `[data-simply-template="contacts"]`
3. re-renders affected DOM roots

### Styles

Styles use:

```html
<style id="css.contacts">
```

A live style update replaces the matching style element’s `textContent`, creating the element if needed.

### Actions, commands, transformers, API methods

These are replaced directly in the app structure. Future calls use the replacement. No DOM side effect is needed.

### Start hooks

Live replacement updates the hook for the next reload/replay but does not run it automatically.

The editor may offer an explicit “Run start hook now” button.

### Routes

Routes belong to page components. Route changes are not automatically applied live.

Route tables are usually rebuilt from start hooks. Changing routes may make the current URL no longer match. The proof of concept should use the simplest reliable behavior:

```txt
Route changed. Reload to apply.
```

## Update policy while editing

Avoid overly eager live updates.

For HTML/CSS:

- validate while editing
- do not update the running app automatically while diagnostics report errors
- allow explicit Save anyway, because validators may lag behind new browser features

For JavaScript functions:

- syntax/compile errors prevent save/apply
- valid functions can be saved/applied
- runtime errors are recovered through undo/reload/reset

## Undo, rollback, reset, reload

The browser-local overlay log is the source of truth.

Rules:

```txt
Live save
  save overlay and apply immediately

Undo
  disable the latest enabled local overlay and reload/replay

Rollback
  disable all overlays after a selected point and reload/replay

Reset
  disable/delete all local overlays for this app and reload base app

Reload
  reload the app and replay enabled overlays
```

Undo/rollback/reset should not try to reverse-mutate the running app. They change the enabled overlay list and reload/replay.

## Storage

The first version stores overlays in browser-local storage, preferably IndexedDB.

Scope:

```txt
browser origin + app id
```

User-facing wording:

```txt
These changes are stored in this browser only.
You can reset them from the editor, or by clearing this site’s browser data.
```

The overlay format should remain storage-independent so overlays can later be exported, saved to a Solid pod, or published as public mods.

## Editor window

The residential editor should open in a separate browser window, not inside the app DOM.

Reason:

- app reloads are part of the recovery model
- editor state should not be destroyed by app reloads
- route changes may require app reloads

The editor is still attached to the app, not a separate independent project URL.

The application uses an explicit editor URI, not an npm-style import:

```js
export const app = simply.app({
  residential: {
    editor: 'https://tools.muze.nl/residential/editor.mjs'
  },

  commands: {
    async openResidentialEditor() {
      const editor = await import(this.residential.editor)
      editor.openResidentialEditor(this)
    }
  }
})
```

The editor is lazy-loaded only when the user chooses the menu/command.

## Minimal reconnection

If the application window reloads and detects that the editor window is still open, it should reconnect without reloading the editor.

The reconnect only needs to give the existing editor window access to the new live app instance/control object again.

The first proof of concept does not need robust recovery of every editor UI detail. It should only ensure that after app reload, the editor can inspect/edit the new app instance again.

## Editor UI

The first editor navigation model should be simple:

1. Flat component list from `app.components`.
2. Component detail view with public editable surfaces.

Component list example:

```txt
contacts
  Shows the contact list and lets the user select a contact.

contactEditor
  Lets the user edit and save one contact.

contactsPage
  Places the contact list and editor on the contacts page.
```

Component detail example:

```txt
contacts

Template
Style
Actions
  load
  save
Commands
  select
Transformers
Scope
Start
```

The editor should also show local overlay history:

```txt
Local changes
  ✓ Changed contacts template
  ✓ Changed contacts actions.save

[Undo last]
[Reload app]
[Reset local changes]
```

Later versions may show which parts are overridden in the current layer and which parts are inherited from the previous active component, but this is not needed for the proof of concept.

## Error handling

Function syntax/compilation errors prevent saving because there is no executable replacement.

Other diagnostics, such as imperfect HTML/CSS, are shown but do not necessarily block explicit Save.

If a live overlay causes runtime problems, recovery happens through the overlay log:

```txt
Undo last change
Reload app
Reset local changes
```

## Local edits versus external mods

For the proof of concept, local edits are authored by the current user and stored in their browser. That is equivalent to the user editing and running code in their own browser.

External mods are future work and require a separate trust model. A public mod that changes actions/commands is executable code.

## Future directions

Permanent storage, sharing, and public mods are future-facing.

Do not solve now:

- Solid pod storage of overlays
- public mod catalogs
- compatibility ranges
- trust/review/signatures
- publishing subsets of overlay history
- dependency resolution between mods
- source export back to project files

Make choices now that preserve the future:

- stable app ids
- component-shaped overlay records
- ordered overlays
- storage-independent overlay format
- public component object as the editable surface

Future mod concept:

```txt
browser-local overlay
  → saved to user’s Solid pod
  → exported as file
  → published as public mod for a specific app id
```

## Proof-of-concept scope

The first proof of concept should demonstrate:

- standalone app with stable app id and origin
- explicit editor URI
- editor opens in separate window
- editor lists `app.components`
- optional component descriptions
- edit template
- edit style
- edit action/command function
- add a new component or new public function/template/style
- save as browser-local component-shaped overlay
- apply live
- reload and replay overlays
- undo last by disabling overlay and reloading
- reset local changes

Defer:

- public mods
- Solid pod persistence
- route editor beyond “reload to apply”
- shape editor
- API/start-hook advanced flows
- full SimplyCode integration
- robust cross-window/editor-state recovery
