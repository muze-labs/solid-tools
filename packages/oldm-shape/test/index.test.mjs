import assert from 'node:assert/strict'
import test from 'node:test'
import { packageName } from '../src/index.mjs'

test('oldm-shape scaffold exports package name', () => {
  assert.equal(packageName, '@muze-labs/oldm-shape')
})
