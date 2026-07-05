import assert from 'node:assert/strict'
import test from 'node:test'
import { exampleName } from '../src/index.mjs'

test('tasks example scaffold exports name', () => {
  assert.equal(exampleName, 'tasks')
})
