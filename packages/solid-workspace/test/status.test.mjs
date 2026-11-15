import assert from 'node:assert/strict'
import test from 'node:test'
import { errorStatus, sourceFailureState } from '../src/status.mjs'
import { local, solid, workspace } from '../src/index.mjs'

const forms = {
  direct: status => Object.assign(new Error('HTTP failure'), { status }),
  wrapped: status => new Error('HTTP failure', { cause: { status } })
}

for (const [form, failure] of Object.entries(forms)) {
  for (const [status, state] of [[401, 'auth-needed'], [403, 'auth-needed'],
    [412, 'error'], [503, 'error']]) {
    test(`${form} HTTP ${status} preserves local data and reports ${state}`, async () => {
      const error = failure(status)
      const ws = workspace().add([
        local.memory('draft', { turtle: '<urn:note> <urn:text> "Keep me".' }),
        solid.resource('https://pod.example/notes.ttl', {
          id: 'remote', load: async () => { throw error }
        })
      ])
      await ws.open()
      assert.equal(ws.status.sources.remote.state, state)
      assert.equal(ws.status.sources.remote.error, error)
      assert.equal(ws.status.sources.draft.state, 'ready')
      assert(ws.context.data.some(subject => subject.id === 'urn:note'))
      assert.equal(errorStatus(error), status)
    })
  }
}

test('an explicit HTTP status takes precedence over a nested status and error name', () => {
  const error = Object.assign(new TypeError('HTTP failure', {
    cause: { status: 401 }
  }), { status: 503 })
  assert.equal(sourceFailureState(error), 'error')
  assert.equal(errorStatus(error), 503)
})

test('network errors without an HTTP status still report offline', () => {
  assert.equal(sourceFailureState(new TypeError('Failed to fetch')), 'offline')
  assert.equal(sourceFailureState(new Error('Disconnected')), 'offline')
})

for (const [form, failure] of Object.entries(forms)) {
  for (const status of [404, 410]) {
    test(`${form} missing-resource HTTP ${status} retains empty-source behavior`, async () => {
      const ws = workspace({ solid: { get: async () => { throw failure(status) } } })
        .add(solid.resource('https://pod.example/missing.ttl', { id: 'remote' }))
      await ws.load()
      assert.equal(ws.status.sources.remote.state, 'ready')
      assert.equal(ws.context.data.length, 0)
    })
  }
}

for (const [form, failure] of Object.entries(forms)) {
  for (const status of [401, 412]) {
    test(`${form} HTTP ${status} on save retains edits until explicit retry`, async () => {
      const error = failure(status)
      let rejectWrite = true
      let writes = 0
      let saved
      const ws = workspace().add(solid.resource('https://pod.example/notes.ttl', {
        id: 'remote',
        load: async () => '<urn:note> <https://schema.org/text> "Original".',
        save: async turtle => {
          writes++
          if (rejectWrite) {
            throw error
          }
          saved = turtle
          return { ok: true }
        }
      }))
      await ws.open()
      const note = ws.graph('remote').get('urn:note')
      note.schema$text = 'Edited'
      const failed = await ws.save(note)
      assert.equal(failed.ok, false)
      assert.equal(failed.error, error)
      assert.equal(ws.status.sources.remote.state, status === 401 ? 'auth-needed' : 'error')
      assert.equal(String(note.schema$text), 'Edited')
      assert.equal(writes, 1)
      rejectWrite = false
      assert.equal((await ws.save(note)).ok, true)
      assert.equal(writes, 2)
      assert.match(saved, /Edited/)
      assert.equal(ws.status.sources.remote.state, 'ready')
      assert.equal(ws.status.sources.remote.error, null)
    })
  }
}
