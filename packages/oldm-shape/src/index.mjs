export const packageName = '@muze-labs/oldm-shape'

const oldmNamePattern = /^[A-Za-z][\w-]*\$[\w-]+$/
const supportedKinds = new Set(['any', 'boolean', 'date', 'iri', 'number', 'object', 'reference', 'string'])

export function shape(definition = {}) {
  return createShape(definition, { fragment: false })
}

shape.fragment = function fragment(definition = {}) {
  return createShape(definition, { fragment: true })
}

export const field = Object.freeze({
  any: options => createField('any', options),
  boolean: options => createField('boolean', options),
  date: options => createField('date', options),
  iri: options => createField('iri', options),
  number: options => createField('number', options),
  object: options => createField('object', options),
  reference: options => createField('reference', options),
  string: options => createField('string', options)
})

export function isOldmName(value) {
  return typeof value === 'string' && oldmNamePattern.test(value)
}

function createShape(definition, { fragment }) {
  if (!definition || typeof definition !== 'object' || Array.isArray(definition)) {
    throw new TypeError('oldm-shape: shape definition must be an object')
  }

  const { id, fields = {}, ...metadata } = definition
  const className = definition.class

  if (className !== undefined && !isOldmName(className)) {
    throw new TypeError(`oldm-shape: class must be an OLDMed name, received ${String(className)}`)
  }

  const normalizedFields = normalizeFields(fields)

  const api = {
    kind: fragment ? 'fragment' : 'shape',
    fragment,
    id,
    class: className,
    fields: normalizedFields,
    ...metadata,
    applyDefaults(value = {}) {
      return applyDefaults(value, normalizedFields)
    },
    validate(value = {}) {
      return validateShape(api, value)
    },
    satisfies(requirement) {
      return satisfiesShape(api, requirement)
    }
  }

  return Object.freeze(api)
}

function normalizeFields(fields) {
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
    throw new TypeError('oldm-shape: fields must be an object')
  }

  return Object.freeze(Object.fromEntries(
    Object.entries(fields).map(([name, descriptor]) => {
      if (!isOldmName(name)) {
        throw new TypeError(`oldm-shape: field name must be an OLDMed name, received ${name}`)
      }

      return [name, normalizeField(descriptor)]
    })
  ))
}

function createField(kind, options = {}) {
  if (!supportedKinds.has(kind)) {
    throw new TypeError(`oldm-shape: unsupported field kind ${kind}`)
  }

  if (options === undefined) {
    options = {}
  }

  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('oldm-shape: field options must be an object')
  }

  const min = options.min ?? (options.required ? 1 : 0)
  const max = options.max ?? (options.many ? Infinity : 1)

  if (!Number.isInteger(min) || min < 0) {
    throw new TypeError(`oldm-shape: field min must be a non-negative integer, received ${String(min)}`)
  }

  if (max !== Infinity && (!Number.isInteger(max) || max < 0)) {
    throw new TypeError(`oldm-shape: field max must be a non-negative integer or Infinity, received ${String(max)}`)
  }

  if (min > max) {
    throw new RangeError(`oldm-shape: field min ${min} cannot be greater than max ${String(max)}`)
  }

  const fieldDefinition = {
    ...options,
    kind,
    min,
    max,
    many: max !== 1
  }

  return Object.freeze(fieldDefinition)
}

function normalizeField(descriptor) {
  if (!descriptor || typeof descriptor !== 'object' || Array.isArray(descriptor)) {
    throw new TypeError('oldm-shape: field descriptor must be created with field.*()')
  }

  return createField(descriptor.kind, descriptor)
}

function applyDefaults(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('oldm-shape: value must be an object')
  }

  const next = { ...value }

  for (const [name, descriptor] of Object.entries(fields)) {
    if (countValues(next[name]) === 0 && Object.hasOwn(descriptor, 'default')) {
      next[name] = defaultValue(descriptor.default)
    }
  }

  return next
}

function validateShape(currentShape, value) {
  const data = currentShape.applyDefaults(value)
  const issues = []

  if (currentShape.class) {
    const classes = values(data.rdf$type)

    if (classes.length === 0) {
      issues.push(issue('missing_class', 'rdf$type', `Expected class ${currentShape.class}`))
    } else if (!classes.includes(currentShape.class)) {
      issues.push(issue('class_mismatch', 'rdf$type', `Expected class ${currentShape.class}`, {
        expected: currentShape.class,
        actual: classes
      }))
    }
  }

  for (const [name, descriptor] of Object.entries(currentShape.fields)) {
    validateField(issues, name, descriptor, data[name])
  }

  return diagnostics(issues, {
    data,
    shape: currentShape
  })
}

function validateField(issues, name, descriptor, rawValue) {
  const fieldValues = values(rawValue)

  if (fieldValues.length < descriptor.min) {
    issues.push(issue('min', name, `Expected at least ${descriptor.min} value(s) for ${name}`, {
      expected: descriptor.min,
      actual: fieldValues.length
    }))
  }

  if (fieldValues.length > descriptor.max) {
    issues.push(issue('max', name, `Expected at most ${formatMax(descriptor.max)} value(s) for ${name}`, {
      expected: descriptor.max,
      actual: fieldValues.length
    }))
  }

  for (const value of fieldValues) {
    if (!matchesKind(descriptor.kind, value)) {
      issues.push(issue('kind', name, `Expected ${name} to contain ${descriptor.kind} value(s)`, {
        expected: descriptor.kind,
        actual: typeof value,
        value
      }))
    }
  }
}

function satisfiesShape(currentShape, requirement) {
  const requiredShape = assertShape(requirement)
  const issues = []

  if (requiredShape.class && currentShape.class !== requiredShape.class) {
    issues.push(issue('class', 'class', `Expected shape class ${requiredShape.class}`, {
      expected: requiredShape.class,
      actual: currentShape.class
    }))
  }

  for (const [name, requiredField] of Object.entries(requiredShape.fields)) {
    const actualField = currentShape.fields[name]

    if (!actualField) {
      issues.push(issue('missing_field', name, `Missing field ${name}`))
      continue
    }

    if (!kindSatisfies(actualField.kind, requiredField.kind)) {
      issues.push(issue('kind', name, `Expected ${name} to be ${requiredField.kind}`, {
        expected: requiredField.kind,
        actual: actualField.kind
      }))
    }

    if (actualField.min < requiredField.min) {
      issues.push(issue('min', name, `Expected ${name} to require at least ${requiredField.min} value(s)`, {
        expected: requiredField.min,
        actual: actualField.min
      }))
    }

    if (actualField.max > requiredField.max) {
      issues.push(issue('max', name, `Expected ${name} to allow at most ${formatMax(requiredField.max)} value(s)`, {
        expected: requiredField.max,
        actual: actualField.max
      }))
    }
  }

  return diagnostics(issues, {
    requirement: requiredShape,
    shape: currentShape
  })
}

function assertShape(value) {
  if (!value || typeof value !== 'object' || !value.fields || typeof value.validate !== 'function') {
    throw new TypeError('oldm-shape: requirement must be a shape or shape.fragment')
  }

  return value
}

function kindSatisfies(actualKind, requiredKind) {
  return requiredKind === 'any' || actualKind === requiredKind
}

function matchesKind(kind, value) {
  switch (kind) {
    case 'any':
      return true
    case 'boolean':
      return typeof value === 'boolean'
    case 'date':
      return value instanceof Date || (typeof value === 'string' && !Number.isNaN(Date.parse(value)))
    case 'iri':
    case 'reference':
      return typeof value === 'string' || Boolean(value && typeof value === 'object' && typeof value.id === 'string')
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
    case 'object':
      return Boolean(value && typeof value === 'object' && !Array.isArray(value))
    case 'string':
      return typeof value === 'string'
    default:
      return false
  }
}

function values(value) {
  if (value === undefined || value === null) {
    return []
  }

  return Array.isArray(value) ? value : [value]
}

function countValues(value) {
  return values(value).length
}

function defaultValue(value) {
  const next = typeof value === 'function' ? value() : value

  if (Array.isArray(next)) {
    return [...next]
  }

  if (next && typeof next === 'object' && !(next instanceof Date)) {
    return { ...next }
  }

  return next
}

function diagnostics(issues, context) {
  return Object.freeze({
    ok: issues.length === 0,
    issues,
    ...context
  })
}

function issue(code, path, message, details = {}) {
  return Object.freeze({
    code,
    path,
    message,
    ...details
  })
}

function formatMax(max) {
  return max === Infinity ? 'unlimited' : String(max)
}

export default {
  packageName,
  shape,
  field,
  isOldmName
}
