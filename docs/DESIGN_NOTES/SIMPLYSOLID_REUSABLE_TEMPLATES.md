# SimplySolid reusable templates and linked-data semantics

## Purpose

Reusable templates/components should make linked-data-native reuse practical without forcing authors to learn all of RDFa or SHACL.

The goal is semantic component reuse:

```txt
A component can say:
  I render or edit something shaped like schema$Person.

An app can say:
  My contacts are schema$Person-shaped enough for that component.

SimplyCode can verify:
  This component fits this data collection.
```

## Primary authoring model

Templates use SimplyFlow attributes and OLDMed prefixed names.

Use:

```html
<article data-simply-shape="schema$Person">
  <h2 data-simply-field="schema$name"></h2>
  <img data-simply-field="schema$image">
  <p data-simply-field="schema$description"></p>
</article>
```

Do not require RDFa as the primary authoring style.

Use one representation of prefixed names everywhere:

```txt
schema$Person
schema$name
schema$image
```

Later, Turtle/RDF syntax can teach that `$` is represented as `:` in RDF.

## data-simply-shape

`data-simply-shape` declares the linked-data shape/class context of a template or template section.

Example:

```html
<form data-simply-shape="schema$Person">
  <input data-simply-edit="schema$name" required>
  <input type="date" data-simply-edit="schema$birthDate">
</form>
```

The template tells us which linked-data fields are used. oldm-shape remains the authoritative contract for datatypes, cardinality, requiredness, defaults, validation, relationships, and migrations.

## Template discovery versus shape authority

A template can reveal what a component touches:

```txt
schema$name is read
schema$image is read
schema$birthDate is edited
schema$knows is listed
```

But a template cannot safely define the full data contract:

```txt
Is schema$name required?
Is schema$image an IRI or ImageObject?
Is schema$knows a reference or embedded object?
What is the cardinality?
What validation applies?
```

So template discovery should generate shape requirements or draft fragments, not silently define truth.

The authoritative contract is an oldm-shape or oldm-shape fragment.

## Component shape fragments

Reusable components often require only a fragment of a full resource shape.

Example:

```js
export const PersonCardShape = shape.fragment({
  id: 'https://components.muze.nl/person-card/shapes#PersonCard',
  class: 'schema$Person',

  fields: {
    schema$name: field.string({ min: 1, max: 1 }),
    schema$image: field.iri({ max: 1 })
  }
})
```

An application shape can satisfy this fragment while containing additional fields:

```js
export const ContactShape = shape({
  id: 'https://apps.muze.nl/contacts/shapes#Contact',
  class: 'schema$Person',

  fields: {
    schema$name: field.string({ min: 1, max: 1 }),
    schema$image: field.iri({ max: 1 }),
    schema$email: field.string({ many: true }),
    schema$telephone: field.string({ many: true })
  }
})
```

The component does not require the app to use exactly `PersonCardShape`; it requires a shape that satisfies the fragment.

## Plain object components

Reusable components are plain SimplyFlow component objects.

Example:

```js
export const personCard = {
  name: 'personCard',
  description: 'Shows a compact card for a person.',

  solid: {
    shape: PersonCardShape,
    mode: 'view'
  },

  template: `
    <article data-simply-shape="schema$Person">
      <h2 data-simply-field="schema$name"></h2>
      <img data-simply-field="schema$image">
    </article>
  `
}
```

No component class or factory is required.

A component may optionally include a human-readable `description`. Residential editors and SimplyCode should show this description to guide users browsing or searching components.

## Component names

Each component in a SimplyFlow application must have a unique name because components live in the app-wide `app.components` set.

Components may include other components. Included components are also visible directly from `app.components`, while the inclusion relationship remains visible for browsing a live component stack.

Component names are important for:

- SimplyFlow component composition
- residential editing
- local overlays
- future mods
- SimplyCode diagnostics

## Template inclusion

Residential programming and reusable templates should not introduce a new component placement mechanism. Use SimplyFlow’s existing template inclusion mechanisms.

Direct render:

```html
<simply-render rel="contactSearch"></simply-render>
```

Template inside a binding/list/map:

```html
<ul data-simply-list="contacts">
  <template rel="contactCard"></template>
</ul>
```

A new component/template becomes visible only when another template includes it.

## Template identity and live updates

Each SimplyFlow template already has an app-wide unique name and is stored in the DOM as:

```html
<template id="contacts">
  ...
</template>
```

Rendered roots should be marked with:

```html
<section data-simply-template="contacts">
  ...
</section>
```

When a residential overlay replaces a template with the same name, it updates:

```html
<template id="contacts">
```

and can find rendered DOM roots with:

```js
document.querySelectorAll('[data-simply-template="contacts"]')
```

Template names are app-wide unique. Same-name templates override earlier templates.

## Style identity and live updates

SimplyFlow styles use DOM style elements with ids in the form:

```html
<style id="css.contacts">
  ...
</style>
```

A residential style update changes the matching style element’s `textContent`, creating it if needed.

Same-name CSS/style ids override earlier styles.

## RDFa conversion

RDFa is useful as an interoperability format, but should not be required for the primary authoring model.

SimplySolid template:

```html
<article data-simply-shape="schema$Person">
  <h2 data-simply-field="schema$name"></h2>
</article>
```

Can export to RDFa-like markup:

```html
<article typeof="schema:Person">
  <h2 property="schema:name" data-simply-field></h2>
</article>
```

And RDFa can import back by converting `schema:Person` / `schema:name` to `schema$Person` / `schema$name`.

The design rule:

```txt
SimplySolid does not require semantic HTML. It uses SimplyFlow attributes with
OLDMed linked-data names. RDFa-style markup may be supported as an optional
import/export bridge.
```

## Template discovery output

A discovery tool can parse:

```html
<section data-simply-shape="schema$Person">
  <h2 data-simply-field="schema$name"></h2>
  <ul data-simply-list="schema$knows">
    <template data-simply-shape="schema$Person">
      <li data-simply-field="schema$name"></li>
    </template>
  </ul>
</section>
```

And infer:

```txt
Shape/class context:
  schema$Person

Fields used:
  schema$name read
  schema$knows list/read

Nested item context:
  schema$Person
  schema$name read
```

Diagnostics can say:

```txt
schema$name: datatype unknown unless declared in oldm-shape.
schema$knows: inferred many:true from data-simply-list.
No required fields inferred from template alone.
```

## Semantic matching belongs to SimplyCode

SimplySolid should not search catalogs or decide which component best fits a data shape.

SimplyCode should use:

- oldm-shape satisfaction checks
- template discovery
- Turtle package metadata
- recipe-defined catalogs/resources

To answer:

- Which components can render this shape?
- Which components can edit this shape?
- What fields are missing?
- Which imports are needed?
- How should this component be placed into a page?

## Turtle-first package metadata

Reusable components/packages should publish metadata as Turtle.

This metadata can describe:

- components provided by the package
- templates
- modules
- shape fragments
- fields required
- modes such as view/edit/create/manage
- access needs
- examples and documentation

Turtle is preferred because the metadata is itself linked data.

## Page-owned routing

Routes belong to pages, not nested reusable feature components.

Reusable feature components can expose events, commands, inputs, and actions. Pages decide where the components appear and how URL state maps to them.

This rule remains important for residential programming: route edits happen on page components and generally require an explicit route-table update or reload.

## Relationship to residential programming

Reusable templates/components are also the public surface for residential programming.

The live residential editor browses `app.components`, shows component names/descriptions, and edits public component properties such as templates, styles, actions, commands, transformers, scope, start hooks, and page routes.

Residential overlays are same-name component overlays. They can override existing components or add new components. They can also add new public component properties such as actions, commands, templates, styles, transformers, and API methods.

The reusable-template design should therefore preserve:

- plain object components
- unique names
- optional descriptions
- stable template ids
- stable style ids
- linked-data-native field names
- explicit page-owned routing

## Roadmap

### Milestone 1 — Template discovery PoC

- parse `data-simply-shape`
- parse `data-simply-field/edit/list/map`
- collect used OLDMed terms
- generate diagnostics

### Milestone 2 — oldm-shape verification

- compare template usage to declared shape fragment
- report missing/unused fields
- check mode: view/edit/create/manage

### Milestone 3 — RDFa conversion

- import RDFa-like markup into SimplyFlow/OLDMed template syntax
- export SimplyFlow/OLDMed templates to RDFa-like markup where useful

### Milestone 4 — SimplyCode component matching

- search Turtle package metadata
- match component shape fragments to app data shapes
- explain compatibility and missing fields

### Milestone 5 — Residential template editing

- live-update template ids
- mark rendered roots with `data-simply-template`
- re-render affected roots after explicit save
