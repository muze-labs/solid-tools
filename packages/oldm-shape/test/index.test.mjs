import assert from 'node:assert/strict'
import test from 'node:test'
import { field, isOldmName, packageName, shape } from '../src/index.mjs'

test('oldm-shape scaffold exports package name', () => {
  assert.equal(packageName, '@muze-labs/oldm-shape')
})

test('field helpers define kind and cardinality', () => {
  assert.deepEqual(field.string({ min: 1 }), {
    kind: 'string',
    min: 1,
    max: 1,
    many: false
  })

  assert.deepEqual(field.iri({ many: true }), {
    kind: 'iri',
    min: 0,
    max: Infinity,
    many: true
  })
})

test('shape validates OLDMed objects and applies defaults without mutation', () => {
  const ContactShape = shape({
    id: 'https://apps.example/shapes#Contact',
    class: 'schema$Person',
    fields: {
      schema$name: field.string({ min: 1, max: 1 }),
      schema$email: field.string({ many: true }),
      schema$image: field.iri({ max: 1, default: 'https://example.test/default.png' })
    }
  })

  const contact = {
    rdf$type: 'schema$Person',
    schema$name: 'Ada',
    schema$email: ['ada@example.test', 'ada@work.example']
  }

  const result = ContactShape.validate(contact)

  assert.equal(result.ok, true)
  assert.equal(result.issues.length, 0)
  assert.equal(result.data.schema$image, 'https://example.test/default.png')
  assert.equal(contact.schema$image, undefined)
})

test('shape validation reports cardinality, kind, and class diagnostics', () => {
  const ContactShape = shape({
    class: 'schema$Person',
    fields: {
      schema$name: field.string({ min: 1, max: 1 }),
      schema$image: field.iri({ max: 1 })
    }
  })

  const result = ContactShape.validate({
    rdf$type: 'schema$Thing',
    schema$name: ['Ada', 'Lovelace'],
    schema$image: 42
  })

  assert.equal(result.ok, false)
  assert.deepEqual(result.issues.map(({ code, path }) => [code, path]), [
    ['class_mismatch', 'rdf$type'],
    ['max', 'schema$name'],
    ['kind', 'schema$image']
  ])
})

test('shape.fragment can be satisfied by a stricter application shape with extra fields', () => {
  const PersonCardShape = shape.fragment({
    id: 'https://components.example/person-card#Shape',
    class: 'schema$Person',
    fields: {
      schema$name: field.string({ min: 1, max: 1 }),
      schema$image: field.iri({ max: 1 })
    }
  })

  const ContactShape = shape({
    id: 'https://apps.example/contacts#Shape',
    class: 'schema$Person',
    fields: {
      schema$name: field.string({ min: 1, max: 1 }),
      schema$image: field.iri({ max: 1 }),
      schema$email: field.string({ many: true })
    }
  })

  const result = ContactShape.satisfies(PersonCardShape)

  assert.equal(PersonCardShape.kind, 'fragment')
  assert.equal(result.ok, true)
  assert.equal(result.issues.length, 0)
})

test('shape satisfaction reports incompatible fragments', () => {
  const PersonCardShape = shape.fragment({
    class: 'schema$Person',
    fields: {
      schema$name: field.string({ min: 1, max: 1 }),
      schema$image: field.iri({ max: 1 })
    }
  })

  const LooseContactShape = shape({
    class: 'schema$Organization',
    fields: {
      schema$name: field.string({ max: 1 }),
      schema$image: field.iri({ many: true })
    }
  })

  const result = LooseContactShape.satisfies(PersonCardShape)

  assert.equal(result.ok, false)
  assert.deepEqual(result.issues.map(({ code, path }) => [code, path]), [
    ['class', 'class'],
    ['min', 'schema$name'],
    ['max', 'schema$image']
  ])
})

test('shape definitions require OLDMed names', () => {
  assert.equal(isOldmName('schema$name'), true)
  assert.equal(isOldmName('schema:name'), false)

  assert.throws(() => shape({
    class: 'schema:Person',
    fields: {}
  }), /OLDMed name/)

  assert.throws(() => shape({
    fields: {
      'schema:name': field.string()
    }
  }), /OLDMed name/)
})
