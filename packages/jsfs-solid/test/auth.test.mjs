import assert from 'node:assert/strict'
import test from 'node:test'
import {
  default as jsfsSolid,
  authorizePopup,
  popupHandleRedirect
} from '../src/index.mjs'

test('exports popup OAuth helpers for Solid app setup', () => {
  assert.equal(typeof authorizePopup, 'function')
  assert.equal(typeof popupHandleRedirect, 'function')
  assert.equal(jsfsSolid.authorizePopup, authorizePopup)
  assert.equal(jsfsSolid.popupHandleRedirect, popupHandleRedirect)
})
