import assert from 'node:assert/strict'
import test from 'node:test'
import { packageName, solid } from '../src/index.mjs'

test('solid-workspace scaffold exports source descriptors', () => {
  assert.equal(packageName, '@muze-labs/solid-workspace')
  assert.deepEqual(solid.resource('/a.ttl'), { kind: 'resource', url: '/a.ttl' })
})
