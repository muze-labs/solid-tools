# @muze-labs/oldm-shape

Native linked-data shape declarations for SimplySolid and reusable templates.

This package defines inspectable data contracts over OLDMed JavaScript objects. It does not parse RDF, load Solid resources, choose UI components, or map objects to graphs; those concerns stay in OLDM, Lading, Solid Workspace, SimplySolid, and SimplyCode.

## Usage

```js
import { field, shape } from '@muze-labs/oldm-shape'

export const PersonCardShape = shape.fragment({
  id: 'https://components.example/person-card#Shape',
  class: 'schema$Person',
  fields: {
    schema$name: field.string({ min: 1, max: 1 }),
    schema$image: field.iri({ max: 1 })
  }
})

export const ContactShape = shape({
  id: 'https://apps.example/contacts#Shape',
  class: 'schema$Person',
  fields: {
    schema$name: field.string({ min: 1, max: 1 }),
    schema$image: field.iri({ max: 1 }),
    schema$email: field.string({ many: true })
  }
})

const validation = ContactShape.validate({
  rdf$type: 'schema$Person',
  schema$name: 'Ada'
})

const compatibility = ContactShape.satisfies(PersonCardShape)
```

Both `validate()` and `satisfies()` return diagnostics:

```js
{
  ok: true,
  issues: []
}
```

Field helpers include `field.string`, `field.iri`, `field.date`, `field.number`, `field.boolean`, `field.object`, `field.reference`, and `field.any`.

Cardinality is declared with `min`, `max`, or `many`. Shape and field names use OLDMed `$` names such as `schema$Person` and `schema$name`.
