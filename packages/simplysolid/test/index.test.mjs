import assert from 'node:assert/strict'
import test from 'node:test'
import { packageName } from '../src/index.mjs'

test('simplysolid scaffold exports package name', () => {
  assert.equal(packageName, '@muze-labs/simplysolid')
})
