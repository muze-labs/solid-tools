import { parseGraph } from '../../solid-workspace/src/graphs.mjs'
import assert from 'node:assert/strict'
import test from 'node:test'
import { simplySolid } from '../src/index.mjs'
import { local } from '@muze-labs/solid-workspace'

test('collection writes reject failed persistence and retain failure when listed', async () => {
  const failure = new Error('local transaction aborted')
  let fail = true
  const memory = local.memory('notes')
  const service = simplySolid({ data: { notes: {
    local: { ...memory, async save(value) { if (fail) throw failure; return memory.save(value) } }
  } } })
  await service.open()
  await assert.rejects(service.data.notes.create({ id: 'urn:note:1', schema$text: 'draft' }), error => error === failure)
  assert.equal(service.data.notes.status.lastSave.ok, false)
  assert.equal(service.data.notes.status.state, 'error')
  service.data.notes.list()
  assert.equal(service.data.notes.status.state, 'error')
  fail = false
  await service.data.notes.saveAll()
  assert.equal(service.data.notes.status.state, 'ready')
})

test('failed replica sync is pending rather than a successful service sync', async () => {
  const memory = local.memory('notes')
  const remote = local.memory('remote')
  const failure = new Error('offline')
  const service = simplySolid({ data: { notes: {
    local: memory, remote: { ...remote, async save() { throw failure } }
  } } })
  await service.open()
  await service.data.notes.create({ id: 'urn:note:1', schema$text: 'local' })
  const result = await service.sync('notes')
  assert.equal(result.ok, false)
  assert.equal(service.status.state, 'sync-pending')
  assert.equal(service.status.error, failure)
  assert.equal(service.status.lastSync, undefined)
  assert.equal(String(parseGraph(await memory.load(), memory).subjects['urn:note:1'].schema$text), 'local')
})

test('a failed delete can be retried by id', async () => {
  const memory = local.memory('notes')
  let fail = false
  const service = simplySolid({ data: { notes: { local: {
    ...memory, async save(value) { if (fail) throw new Error('disk full'); return memory.save(value) }
  } } } })
  await service.open()
  await service.data.notes.create({ id: 'urn:note:1', schema$text: 'keep until deleted' })
  fail = true
  await assert.rejects(service.data.notes.delete('urn:note:1'), /disk full/)
  fail = false
  assert.equal((await service.data.notes.delete('urn:note:1')).ok, true)
  assert.equal(service.data.notes.get('urn:note:1'), null)
})

test('a failed local open rejects instead of presenting an empty ready service', async () => {
  const memory = local.memory('notes')
  const failure = new Error('database unavailable')
  const service = simplySolid({ data: { notes: { local: {
    ...memory, async load() { throw failure }
  } } } })
  await assert.rejects(service.open(), error => error === failure)
  assert.equal(service.status.state, 'error')
})


test('saving an edited native node preserves failures and permits retry by id', async () => {
  let fail = false
  const memory = local.memory('notes')
  const service = simplySolid({ data: { notes: { local: {
    ...memory,
    async save(turtle) {
      if (fail) {
        throw new Error('disk full')
      }
      return memory.save(turtle)
    }
  } } } })
  await service.open()
  const note = await service.data.notes.create({ id: 'urn:note', schema$text: 'before' })
  note.graph.set(note, 'schema$text', 'edited')
  fail = true
  await assert.rejects(service.data.notes.save(note.id), /disk full/)
  assert.equal(service.data.notes.status.state, 'error')
  fail = false
  assert.equal((await service.data.notes.save(note.id)).ok, true)
  assert.equal(String(parseGraph(await memory.load(), memory).get(note.id).schema$text), 'edited')
})
