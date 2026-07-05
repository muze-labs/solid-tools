# SimplyFlow component loading and overlay merge design

Status: design note for the SimplyFlow / SimplySolid / SimplyCode residential programming proof of concept.

This document records the intended SimplyFlow component loading behavior needed by residential programming, local overlays, and remote mods. It is a design document only; it does not require changing SimplyFlow code yet.

## Core principle

There is no separate patching mechanism.

Components are loaded in order. Later loaded component parts overwrite earlier component parts with the same names.

Residential overlays and remote mods should participate in this same component loading model. They are not a second runtime mechanism.


## Application opt-in

Residential programming and mod loading are opt-in app capabilities.

The SimplyFlow merge algorithm must not automatically look for overlays in local storage, remote registries, or any other external source.

An app should load overlays only when it explicitly enables that behavior, for example through a future option such as:

```js
app({
  residential: true,
  components: { ... }
})
```

or a more explicit residential/mod loader integration:

```js
app({
  components: { ... },
  overlays: hydratedOverlays
})
```

In either case, overlay discovery is outside the core merge algorithm.

The opt-in boundary is important because:

- normal SimplyFlow apps should remain deterministic from their source code alone
- local storage should not silently change app behavior unless the app has opted in
- residential programming is a deliberate capability exposed by the app author
- overlay hydration remains the responsibility of residential/mod tooling, not the base app merge

So the rule is:

```txt
No opt-in, no overlay discovery.

If overlays are passed to the merge algorithm, they must already have been explicitly allowed, discovered, composed, and hydrated by app-level residential/mod tooling.
```

## Component shape

Component modules should continue to use the existing SimplyFlow component structure, including map-shaped `templates` and `styles`.

Use this:

```js
export default {
  templates: {
    contactCard: `...`
  },

  styles: {
    contactCard: `...`
  },

  commands: {},
  actions: {},
  api: {},
  transformers: {},

  components: {}
}
```

Do not introduce singular `template` or `style` properties for this design.

## `components` is a component dependency registry

`app.components`, `component.components`, and `overlay.components` should all mean the same kind of thing: a component registry / dependency map.

A component may depend on other components by listing them in its own `components` property:

```js
export default {
  commands: {
    doFoo() {
      return original.commands.doFoo.call(this)
    }
  },

  components: {
    original: 'https://apps.muze.nl/components/foo.js'
  }
}
```

When the component is loaded, dependencies are loaded before the component that depends on them.

Names in `components` become lexical variables for residentially edited functions. In stored form, component entries may be URL strings or virtual/local references. In hydrated runtime form, those references are resolved to component objects before the component is passed into the merge algorithm.

## `components` is not an application API

`app.components` exists so a residential programming environment can inspect and access loaded component source. It should not be used by normal application code.

Normal code should not do this:

```js
this.components.foo.commands.doFoo()
app.components.foo.commands.doFoo()
component.components.foo.commands.doFoo()
```

Normal code should use lexical dependencies instead:

```js
foo.commands.doFoo.call(this)
```

The `components` property is therefore a source/tooling/dependency structure. It is not the primary runtime programming API.

## Duplicate component names

Duplicate local component names are allowed, with warnings.

Example:

```js
components: {
  card: './contact-card.js'
}
```

and elsewhere:

```js
components: {
  card: './product-card.js'
}
```

This is allowed because actual code uses the local lexical variable `card`, not `app.components.card`.

However, `app.components.card` is unstable in this situation: it points to the last loaded component named `card`. The editor should warn when this happens.

Duplicate names become errors only when they make a specific residential operation impossible to resolve.

The editor should maintain its own component graph/index instead of relying only on `app.components`.

## Stored overlays versus hydrated overlays

Stored overlays may contain serializable component references and function source.

Example stored overlay component:

```js
{
  imports: `
import { formatDate } from './lib/dates.js'
`,

  commands: {
    save: {
      $function: `function save(contact) {
        contact.modified = formatDate(new Date())
        return original.commands.save.call(this, contact)
      }`
    }
  },

  components: {
    original: 'https://apps.muze.nl/components/contacts.js'
  }
}
```

Before passing an overlay to the SimplyFlow component merge algorithm, residential tooling should hydrate it:

- resolve component references in `components`
- resolve normal JavaScript imports from `imports`
- compile function source with imported names and component names in lexical scope
- detect cycles in the component graph
- compose installed mods and local edits where needed

The core `mergeComponents` algorithm should not import URLs, read local storage, parse import source, compile functions, or do graph resolution.

## `imports` is for non-component JavaScript imports

Residential overlays may include an `imports` property for normal JavaScript helper imports:

```js
imports: `
import { formatDate } from './lib/dates.js'
import * as schema from './terms/schema.js'
`
```

These are normal JavaScript dependencies. They do not become component graph nodes.

Component dependencies belong in `components`, not in `imports`.

## Load order

The intended merge order is:

```txt
normal components
  → app-level options
    → hydrated overlays
```

This means:

- normal components provide reusable defaults
- app-level options override normal components
- overlays override both normal components and app-level options

This differs from ordinary component loading because app-level options should not be accidentally overridden by normal components, but residential overlays should be able to override app-level behavior.

A future SimplyFlow implementation could express this as:

```js
const mergedOptions = {}

if (options.components) {
  mergeComponents(mergedOptions, options.components)
}

mergeOptions(mergedOptions, omit(options, ['components', 'overlays']))

if (options.overlays) {
  mergeComponents(mergedOptions, options.overlays)
}
```

The important design point is that `options.overlays` must already be hydrated component objects.

## Current SimplyFlow algorithm fit

The current SimplyFlow component merge algorithm already has the right conceptual base for normal component objects:

- nested `component.components` are loaded before the component itself
- `app.components[name]` stores the last loaded component object
- component maps such as `commands`, `actions`, `templates`, and `styles` merge into the app options
- later same-named keys overwrite earlier same-named keys

For the residential/mod design, the algorithm needs only a small conceptual adaptation:

1. `imports` should be ignored by the app option merge, just like `components`, `start`, and `onError`.
2. App-level options should be merged after normal components.
3. Hydrated overlays should be merged after app-level options.
4. Stored overlays should be resolved/hydrated before `mergeComponents` receives them.
5. Merge helpers should remain safe for remote mod data, especially around unsafe object keys such as `__proto__`, `prototype`, and `constructor`.

## Remote mods and composed overlays

Remote mods should be loaded using the same mechanism as local overlays.

At installation/storage level, there may be multiple mods and local edits for the same component.

At runtime/editor level, these should be composed into one hydrated overlay per component before merging into the app.

Example:

```txt
base contacts component
  → composed contacts overlay
```

The composed overlay may be built from:

```txt
Remote Mod A
Remote Mod B
local residential edit
```

using the standard component merge rules:

- map-shaped parts merge by key
- later definitions win for the same key
- conflicts should be visible in the editor
- provenance should be retained for editor display

The editor should present this as one active overlay, not as an overlay stack.

## No local overlay stacks in the proof of concept

For the proof of concept, local overlays should not stack on top of other local overlays.

Remote mods and local edits may be inputs to a composed overlay, but the editor should present and apply the result as a single overlay layer over the base component.

This keeps the model understandable while still allowing useful mod combinations.

## Cycle detection

Because `components` creates a component dependency graph, the residential/mod loader should detect and reject cycles before hydration/merge.

Examples to reject:

```txt
A → B → A
A → B → C → A
```

The proof of concept editor should make this explicit and prevent the user from creating cyclic component references.

## Responsibilities split

Residential/mod loader responsibilities:

```txt
run only when the app has explicitly opted in
read stored overlays
resolve component references
resolve imports
compile function source
compose mods and local edits
track provenance and conflicts
build component graph
reject cycles
produce hydrated component objects
```

SimplyFlow merge responsibilities:

```txt
load component dependencies before dependents
merge component maps into app options
store the last loaded component object in app.components[name]
respect the requested load order
avoid merging source/editor-only keys such as imports
never discover overlays from local storage by itself
```

Keeping this split prevents the core SimplyFlow merge algorithm from becoming a residential-programming runtime.
