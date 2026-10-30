import { graphFixture } from './fixtures.mjs'
import { parseGraph } from '../src/graphs.mjs'
import assert from 'node:assert/strict'
import test from 'node:test'
import { collection, local, resource, workspace } from '../src/index.mjs'
import { isDeleted, mergeReplicas } from '../src/replicas.mjs'
import oldm from '@muze-nl/oldm'

const deleted = 'https://purl.org/pdsinterop/link-metadata#deleted'

const noteId = 'urn:note:one'
const original = { id: noteId, 'schema$text': 'original', 'dcterms$modified': '2026-01-01T00:00:00Z' }
const graphOf = subject => graphFixture([subject])

test('equal timestamps select structured scalars independently of replica order', () => {
  const left = graphOf({ ...original, 'https://example.test/fragment': JSON.stringify({ text: 'same', marks: ['bold'] }) })
  const right = graphOf({ ...original, 'https://example.test/fragment': JSON.stringify({ text: 'same', marks: ['italic'] }) })
  const options = { scalarPredicates: ['https://example.test/fragment'] }
  assert.deepEqual(mergeReplicas([left, right], options).subjects, mergeReplicas([right, left], options).subjects)
})

async function replicas() {
  const localSource = local.memory('notes:local', { turtle: await graphOf(original).write() })
  const remote = local.memory('notes:remote', { turtle: await graphOf(original).write() })
  const ws = workspace({
    resources: [resource('notes', { local: localSource, remote, scalarPredicates: ['https://schema.org/text'] })],
    collections: { notes: collection({ sources: ['notes'], createIn: 'notes' }) }
  })
  await ws.open({ throwOnError: true })
  return { ws, localSource, remote }
}

test('an edited scalar replaces its old remote value while unknown facts survive', async () => {
  const { ws, remote } = await replicas()
  const note = ws.collections.notes.get(noteId)
  note.schema$text = 'edited'
  note.dcterms$modified = '2026-02-01T00:00:00Z'
  note.schema$comment = 'keep local fact'
  await ws.save(note)
  await remote.save(await graphOf({ ...original, schema$comment: 'keep remote fact' }).write())
  assert.equal((await ws.sync('notes')).ok, true)
  const saved = parseGraph(await remote.load(), remote).subjects[noteId]
  assert.equal(String(saved.schema$text), 'edited')
  assert.deepEqual(Array.from(saved.schema$comment, String).sort(), ['keep local fact', 'keep remote fact'])
})

test('deletion survives sync and reopening from the persisted replicas', async () => {
  const { ws, localSource, remote } = await replicas()
  await ws.delete(ws.collections.notes.get(noteId))
  assert.equal((await ws.sync('notes')).ok, true)
  const reopened = workspace({
    resources: [resource('notes', { local: localSource, remote })],
    collections: { notes: collection({ sources: ['notes'] }) }
  })
  await reopened.open({ throwOnError: true })
  assert.equal(reopened.collections.notes.get(noteId), null)
  assert.equal(reopened.collections.notes.list().length, 0)
})

test('remote-only additions are committed locally even when remote needs no write', async () => {
  const { ws, localSource, remote } = await replicas()
  await remote.save(await graphFixture([original, { id: 'urn:note:two', schema$text: 'remote' }]).write())
  assert.equal((await ws.sync('notes')).ok, true)
  assert.equal(String(parseGraph(await localSource.load(), localSource).subjects['urn:note:two'].schema$text), 'remote')
  assert.equal(String(ws.collections.notes.get('urn:note:two').schema$text), 'remote')
})

test('a save admitted during a remote write remains local and pending after sync', async () => {
  const { ws, localSource, remote } = await replicas()
  let release
  let started
  const writing = new Promise(resolve => { started = resolve })
  const held = new Promise(resolve => { release = resolve })
  ws.add(resource('notes', { remote: { ...remote, async save(value) { started(); await held; return remote.save(value) } } }))
  const note = ws.collections.notes.get(noteId)
  note.schema$text = 'first edit'
  note.dcterms$modified = '2026-02-01T00:00:00Z'
  await ws.save(note)
  const syncing = ws.sync('notes')
  await writing
  note.schema$text = 'newer edit'
  note.dcterms$modified = '2026-03-01T00:00:00Z'
  const saving = ws.save(note)
  release()
  await syncing
  assert.equal((await saving).ok, true)
  assert.equal(String(parseGraph(await localSource.load(), localSource).subjects[noteId].schema$text), 'newer edit')
  assert.equal(String(ws.collections.notes.get(noteId).schema$text), 'newer edit')
  assert.equal(ws.status.sources[remote.id].syncPending, true)
  assert.equal((await ws.sync('notes')).ok, true)
  assert.equal(String(parseGraph(await remote.load(), remote).subjects[noteId].schema$text), 'newer edit')
})

test('a failed local sync commit does not write the remote and can be retried', async () => {
  const { ws, localSource, remote } = await replicas()
  let fail = true
  let remoteWrites = 0
  ws.add(resource('notes', {
    local: { ...localSource, async save(value) { if (fail) throw new Error('disk full'); return localSource.save(value) } },
    remote: { ...remote, async save(value) { remoteWrites++; return remote.save(value) } }
  }))
  const result = await ws.sync('notes')
  assert.equal(result.ok, false)
  assert.equal(remoteWrites, 0)
  assert.equal(ws.status.resources.notes.state, 'error')
  fail = false
  assert.equal((await ws.sync('notes')).ok, true)
  assert.equal(ws.status.resources.notes.error, null)
})

test('opening a replica while a save is admitted cannot replace the newer working value', async () => {
  const { ws, localSource } = await replicas()
  let release
  let started
  const loading = new Promise(resolve => { started = resolve })
  const held = new Promise(resolve => { release = resolve })
  ws.add(resource('notes', { local: {
    ...localSource, async load() { const value = await localSource.load(); started(); await held; return value }
  } }))
  const note = ws.collections.notes.get(noteId)
  const opening = ws.open('notes')
  await loading
  note.schema$text = 'saved during open'
  const saving = ws.save(note)
  release()
  await opening
  assert.equal((await saving).ok, true)
  assert.equal(String(ws.collections.notes.get(noteId).schema$text), 'saved during open')
  assert.equal(String(parseGraph(await localSource.load(), localSource).subjects[noteId].schema$text), 'saved during open')
})

test('logical deletion keeps the original subject and its facts in both Turtle replicas', async () => {
  const { ws, localSource, remote } = await replicas()
  const note = ws.collections.notes.get(noteId)
  note.schema$comment = 'unknown fact retained for undo'
  assert.equal((await ws.delete(note)).ok, true)
  assert.equal(ws.collections.notes.get(noteId), null)
  assert.equal((await ws.sync('notes')).ok, true)
  for (const source of [localSource, remote]) {
    const saved = parseGraph(await source.load(), source)
    assert.deepEqual(Object.keys(saved.subjects), [noteId])
    assert.equal(isDeleted(saved.subjects[noteId]), true)
    assert.equal(String(saved.subjects[noteId].schema$text), 'original')
    assert.equal(String(saved.subjects[noteId].schema$comment), 'unknown fact retained for undo')
    const graph = oldm.context().parse(await source.load(), source.url, 'text/turtle')
    assert.equal(String(graph.subjects[noteId][graph.propertyName(deleted)]), 'Deleted by the user')
  }
})

test('deletion wins a timestamp tie in either replica order without losing facts', () => {
  const active = graphOf({ ...original, schema$comment: 'remote unknown fact' })
  const removed = graphOf({ ...original, [deleted]: 'Removed' })
  for (const inputs of [[active, removed], [removed, active]]) {
    const saved = mergeReplicas(inputs).subjects[noteId]
    assert.equal(isDeleted(saved), true)
    assert.equal(saved.schema$text, 'original')
    assert.equal(saved.schema$comment, 'remote unknown fact')
  }
  assert.equal(isDeleted(active.subjects[noteId]), false)
})

test('newer deletion beats a stale active copy and newer restoration removes the marker', () => {
  const active = graphOf(original)
  const removed = graphOf({ ...original, [deleted]: 'Removed', dcterms$modified: '2026-02-01T00:00:00Z' })
  const restored = graphOf({ ...original, dcterms$modified: '2026-03-01T00:00:00Z' })
  for (const inputs of [[active, removed], [removed, active]]) {
    assert.equal(isDeleted(mergeReplicas(inputs).subjects[noteId]), true)
  }
  for (const inputs of [[removed, restored], [restored, removed]]) {
    const result = mergeReplicas(inputs)
    assert.equal(isDeleted(result.subjects[noteId]), false)
    assert.equal(isDeleted(mergeReplicas([result, removed]).subjects[noteId]), false)
    assert.equal(result.subjects[noteId].schema$text, 'original')
  }
})

test('restoration from another replica becomes visible and survives reopening', async () => {
  const { ws, localSource, remote } = await replicas()
  await ws.delete(ws.collections.notes.get(noteId))
  await ws.sync('notes')
  const restored = parseGraph(await remote.load(), remote)
  const note = restored.subjects[noteId]
  delete note[note.graph.propertyName(deleted)]
  note.dcterms$modified = new Date(Date.parse(String(note.dcterms$modified)) + 1000).toISOString()
  await remote.save(await restored.write())
  assert.equal((await ws.sync('notes')).ok, true)
  assert.equal(String(ws.collections.notes.get(noteId).schema$text), 'original')
  const reopened = workspace({
    resources: [resource('notes', { local: localSource, remote })],
    collections: { notes: collection({ sources: ['notes'] }) }
  })
  await reopened.open({ throwOnError: true })
  assert.equal(reopened.collections.notes.list().length, 1)
  assert.equal(isDeleted(parseGraph(await localSource.load(), localSource).subjects[noteId]), false)
})

test('a retained tracked subject can be restored and saved before sync', async () => {
  const { ws, localSource } = await replicas()
  const note = ws.collections.notes.get(noteId)
  await ws.delete(note)
  delete note[note.graph.propertyName(deleted)]
  note.dcterms$modified = new Date(Date.parse(String(note.dcterms$modified)) + 1000).toISOString()
  assert.equal((await ws.save(note)).status, 'saved')
  assert.equal(ws.collections.notes.get(noteId), note)
  assert.equal(isDeleted(parseGraph(await localSource.load(), localSource).subjects[noteId]), false)
})

test('lm:deleted presence hides undated subjects even with false or empty values', async () => {
  const source = local.memory('marked', { turtle: `
    @prefix custom: <https://purl.org/pdsinterop/link-metadata#> .
    <urn:note:false> custom:deleted false .
    <urn:note:empty> custom:deleted "" .
  ` })
  const ws = workspace({
    resources: [resource('notes', { local: source })],
    collections: { notes: collection({ sources: ['notes'] }) }
  })
  await ws.open({ throwOnError: true })
  assert.deepEqual(ws.collections.notes.list(), [])
  assert.equal(Object.keys(ws.graph('notes').subjects).length, 2)
})

test('failed deletion restores the original timestamp and marker state for retry', async () => {
  const { ws, localSource } = await replicas()
  let fail = true
  ws.add(resource('notes', { local: {
    ...localSource, async save(value) { if (fail) throw new Error('disk full'); return localSource.save(value) }
  } }))
  const note = ws.collections.notes.get(noteId)
  const previous = note.dcterms$modified
  assert.equal((await ws.delete(note)).ok, false)
  assert.equal(isDeleted(note), false)
  assert.equal(note.dcterms$modified, previous)
  assert.equal(ws.collections.notes.get(noteId), note)
  assert.equal(isDeleted(parseGraph(await localSource.load(), localSource).subjects[noteId]), false)
  fail = false
  assert.equal((await ws.delete(note)).ok, true)
  assert.equal(isDeleted(parseGraph(await localSource.load(), localSource).subjects[noteId]), true)
})

test('deferred deletion is hidden immediately and persists on saveAll', async () => {
  const { ws, localSource } = await replicas()
  const note = ws.collections.notes.get(noteId)
  assert.equal((await ws.delete(note, { save: false })).status, 'deleted_pending')
  assert.equal(ws.collections.notes.get(noteId), null)
  assert.equal(isDeleted(parseGraph(await localSource.load(), localSource).subjects[noteId]), false)
  await ws.collections.notes.saveAll()
  assert.equal(isDeleted(parseGraph(await localSource.load(), localSource).subjects[noteId]), true)
})
