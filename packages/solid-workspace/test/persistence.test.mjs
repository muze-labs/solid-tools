import { mergeGraphs } from '../src/graphs.mjs'
import { graphFixture } from './fixtures.mjs'
import assert from 'node:assert/strict'
import test from 'node:test'
import oldm from '@muze-nl/oldm'
import { BlankNode, Collection } from '@muze-nl/oldm-core'
import { local, resource, solid, workspace } from '../src/index.mjs'
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
  const note = ws.graph('notes').get('https://example.test/note')
  note.ex$edited = 'yes'
  assert.equal((await ws.save(note)).ok, true)
  const graph = oldm.context().parse(await source.load(), 'https://example.test/notes', 'text/turtle')
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
  const result = mergeGraphs([graphFixture([left]), graphFixture([right])])
  assert.equal(result.subjects[left.id].schema$comment.schema$description, 'unknown fact')
  assert.equal(result.subjects[left.id].schema$comment.schema$about, result.subjects[left.id])
})

test('graph merging retains later prefixes and resolves label conflicts without changing IRIs', async () => {
  const first = graphFixture([{ id: 'https://first.example/one', schema$text: 'First' }], {
    prefixes: { chosen: 'https://first.example/' }
  })
  const second = graphFixture([{ id: 'https://book.example/chapter#margin-note-code-1', schema$text: 'Second' }], {
    prefixes: { note: 'https://book.example/chapter#margin-note-', chosen: 'https://second.example/' }
  })
  const merged = mergeGraphs([first, second])
  assert.equal(merged.prefixes.note, 'https://book.example/chapter#margin-note-')
  assert.equal(merged.prefixes.chosen, 'https://first.example/')
  const turtle = await merged.write()
  assert.match(turtle, /@prefix note:/)
  assert.match(turtle, /note:code-1/)
  const restored = oldm.context().parse(turtle, 'https://pod.example/notes.ttl', 'text/turtle')
  assert.equal(String(restored.get('https://book.example/chapter#margin-note-code-1').schema$text), 'Second')
  assert.equal(second.prefixes.chosen, 'https://second.example/')
})

test('resource base is independent of storage URLs across saves, reloads and reconnects', async () => {
  const baseURI = 'https://book.example/chapter?edition=2'
  const source = local.memory('base', { turtle: `
    @base <https://existing.example/document> .
    <#other> <https://example.test/link> <#target> .
  ` })
  let remoteText = '<#remote> <https://example.test/text> "remote fact" .'
  const remoteUrl = 'https://pod.example/notes.ttl'
  const remote = solid.resource(remoteUrl)
  const writes = []
  const ws = workspace({
    solid: solidApi(metro.client('https://pod.example/', async request => {
      if (request.method === 'GET') {
        return metro.response({ url: request.url, status: 200, body: remoteText, headers: { 'Content-Type': 'text/turtle' } })
      }
      writes.push(request.url)
      remoteText = await request.text()
      return metro.response({ url: request.url, status: 204 })
    })),
    resources: [resource('notes', { local: source, baseURI })]
  })
  await ws.open({ throwOnError: true })
  const note = await ws.createIn('notes', {
    id: `${baseURI}#note`,
    'https://example.test/link': `${baseURI}#paragraph`
  })
  await ws.save(note)
  const firstWrite = await source.load()
  assert.ok(firstWrite.startsWith(`@base <${baseURI}> .`))
  assert.match(firstWrite, /<#paragraph>/)
  assert.equal(ws.graph('notes').url, source.url)
  assert.equal(ws.graph('notes').baseURI, baseURI)
  assert.equal(ws.graph('notes').get('https://existing.example/document#other')['https://example.test/link'].id,
    'https://existing.example/document#target')
  // Adding only the remote replica must retain the configured base.
  ws.addResource(resource('notes', { remote }))
  assert.equal((await ws.sync('notes')).ok, true)
  assert.deepEqual(writes, [remoteUrl])
  assert.ok(remoteText.startsWith(`@base <${baseURI}> .`))
  assert.match(remoteText, /<#paragraph>/)
  const parsed = oldm.context().parse(remoteText, remoteUrl, 'text/turtle')
  assert.equal(parsed.get(note.id)['https://example.test/link'].id, `${baseURI}#paragraph`)
  assert.equal(String(parsed.get(`${remoteUrl}#remote`)['https://example.test/text']), 'remote fact')
  await ws.open({ throwOnError: true })
  assert.equal(ws.graph('notes').url, source.url)
  assert.equal(ws.graph('notes').baseURI, baseURI)
  assert.equal(ws.graph('notes').get(note.id)['https://example.test/link'].id, `${baseURI}#paragraph`)
})


test('resource prefix preferences abbreviate saves and sync without reinterpreting stored predicates', async () => {
  const page = 'https://book.example/chapter'
  const source = local.memory('prefix-policy', { turtle: `
    @prefix note: <${page}#margin-note-> .
    <urn:foreign> note:custom "keep" .
  ` })
  const prefixes = {}
  const ws = workspace({ resources: [resource('notes', { local: source, prefixes })] })
  await ws.open({ throwOnError: true })
  // The application recovers this namespace after loading the resource.
  prefixes.note = `${page}#margin-note-testcode-`
  const note = await ws.createIn('notes', { id: prefixes.note + '1', schema$text: 'current' })
  await ws.save(note)
  let output = await source.load()
  assert.match(output, /note:1 /)
  assert.equal(String(ws.graph('notes').get('urn:foreign')[ws.graph('notes').propertyName(`${page}#margin-note-custom`)]), 'keep')
  const remote = local.memory('prefix-policy-remote', { turtle: `
    @prefix note: <${page}#margin-note-> .
    <urn:remote> note:custom "remote" .
  ` })
  ws.add(resource('notes', { remote }))
  assert.equal((await ws.sync('notes')).ok, true)
  output = await remote.load()
  assert.match(output, /note:1 /)
  assert.ok(output.includes(`@prefix note: <${prefixes.note}>`))
  const restored = oldm.context().parse(output, remote.url, 'text/turtle')
  assert.equal(String(restored.get('urn:foreign')[restored.propertyName(`${page}#margin-note-custom`)]), 'keep')
  assert.equal(String(restored.get('urn:remote')[restored.propertyName(`${page}#margin-note-custom`)]), 'remote')
  assert.equal(restored.get('urn:foreign')[prefixes.note + 'custom'], undefined)
})
