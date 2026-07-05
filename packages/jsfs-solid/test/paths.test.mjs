import assert from 'node:assert/strict'
import test from 'node:test'
import { filename, joinPath, normalizePath, pathFromUrl, resolveSolidUrl } from '../src/paths.mjs'

test('normalizePath removes dot segments', () => {
  assert.equal(normalizePath('/notes/./a/../b.txt'), '/notes/b.txt')
})

test('joinPath joins normalized paths', () => {
  assert.equal(joinPath('/notes', 'drafts/a.txt'), '/notes/drafts/a.txt')
})

test('resolveSolidUrl resolves a path under a Solid root', () => {
  assert.equal(
    resolveSolidUrl('https://pod.example/storage/', '/notes', 'a.txt'),
    'https://pod.example/storage/notes/a.txt'
  )
})

test('pathFromUrl returns a path relative to the root', () => {
  assert.equal(
    pathFromUrl('https://pod.example/storage/', 'https://pod.example/storage/notes/a.txt'),
    '/notes/a.txt'
  )
})

test('filename handles containers and files', () => {
  assert.equal(filename('https://pod.example/storage/notes/a.txt'), 'a.txt')
  assert.equal(filename('https://pod.example/storage/notes/'), 'notes')
})
