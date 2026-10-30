import assert from 'node:assert/strict'
import test from 'node:test'
import oldm from '@muze-nl/oldm'
import { BlankNode, Collection } from '@muze-nl/oldm-core'
import { local, resource, solid, workspace, mergeGraphDocuments } from '../src/index.mjs'
import metro from '@muze-nl/metro'
import { solidApi } from '../../metro-solid/src/index.mjs'

test('local Turtle round trips preserve shared blank nodes, cycles, lists and literals', async () => {
  const source = local.memory('rdf', { turtle: `
    @prefix ex: <https://example.test/> .
    ex:note a ex:Note; ex:extra _:shared; ex:other _:shared; ex:list ("first" "second"@nl); ex:link ex:other .
    _:shared ex:label "Hallo"@nl; ex:self _:shared .
    ex:other ex:link ex:note .
  ` })
  const ws = workspace({ resources: [resource('notes', { local: source })] })
  await ws.open({ throwOnError: true })
  const note = ws.records.find(record => record.object.id === 'https://example.test/note').object
  note.ex$edited = 'yes'
  assert.equal((await ws.save(note)).ok, true)
  const graph = oldm.context().parse(await source.turtle(), 'https://example.test/notes', 'text/turtle')
  const restored = graph.subjects[note.id]
  assert.equal(restored.a, 'https://example.test/Note')
  assert.ok(restored.ex$extra instanceof BlankNode)
  assert.equal(restored.ex$extra, restored.ex$other)
  assert.equal(restored.ex$extra.ex$self, restored.ex$extra)
  assert.equal(restored.ex$extra.ex$label.language, 'nl')
  assert.ok(restored.ex$list instanceof Collection)
  assert.deepEqual(Array.from(restored.ex$list, String), ['first', 'second'])
  assert.equal(restored.ex$list[1].language, 'nl')
  assert.equal(restored.ex$link.ex$link, restored)
  assert.equal(String(restored.ex$edited), 'yes')
})

test('a failed local adapter result is a failed save', async () => {
  const source = local.memory('notes')
  const failure = new Error('disk full')
  const ws = workspace({ resources: [resource('notes', {
    local: { ...source, save: async () => ({ ok: false, error: failure }) }
  })] })
  await ws.open({ throwOnError: true })
  const note = await ws.createIn('notes', { id: 'urn:note:1', 'https://example.test/text': 'draft' }, { save: false })
  const status = await ws.save(note)
  assert.equal(status.ok, false)
  assert.equal(status.error, failure)
})

test('workspace composes with the real Metro and OLDM request/response middleware', async () => {
  let turtle = '@prefix schema: <https://schema.org/> . <urn:note:remote> schema:text "remote" .'
  const client = metro.client('https://pod.example/', async request => {
    if (request.method === 'PUT') {
      assert.equal(request.headers.get('Content-Type'), 'text/turtle')
      turtle = await request.text()
      return metro.response({ url: request.url, status: 204 })
    }
    return metro.response({ url: request.url, status: 200, body: turtle, headers: { 'Content-Type': 'text/turtle' } })
  })
  const ws = workspace({
    solid: solidApi(client),
    resources: [resource('notes', {
      local: local.memory('notes'),
      remote: solid.resource('https://pod.example/notes.ttl')
    })]
  })
  await ws.open({ throwOnError: true })
  await ws.createIn('notes', { id: 'urn:note:local', schema$text: 'local' })
  assert.equal((await ws.sync('notes')).ok, true)
  const restored = oldm.context().parse(turtle, 'https://pod.example/notes.ttl', 'text/turtle')
  assert.equal(String(restored.subjects['urn:note:local'].schema$text), 'local')
  assert.equal(String(restored.subjects['urn:note:remote'].schema$text), 'remote')
})

test('merging linked subjects preserves incoming unknown facts and cycles', () => {
  const left = { id: 'urn:note:1', schema$comment: { id: 'urn:body:1', schema$text: 'body' } }
  left.schema$comment.schema$about = left
  const right = { id: left.id, schema$comment: { id: 'urn:body:1', schema$description: 'unknown fact' } }
  right.schema$comment.schema$about = right
  const result = mergeGraphDocuments([[left], [right]])
  assert.equal(result.subjects[left.id].schema$comment.schema$description, 'unknown fact')
  assert.equal(result.subjects[left.id].schema$comment.schema$about, result.subjects[left.id])
})
