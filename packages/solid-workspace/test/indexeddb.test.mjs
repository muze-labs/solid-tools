import assert from 'node:assert/strict'
import test from 'node:test'
import { indexedDBGet, indexedDBPut } from '../src/indexeddb.mjs'

for (const operation of ['get', 'put']) {
  test(`${operation} waits for transaction commit, not request success`, async () => {
    const { database, transaction, request } = controlledDatabase()
    let settled = false
    const result = (operation === 'get'
      ? indexedDBGet(database, 'resources', 'notes')
      : indexedDBPut(database, 'resources', { key: 'notes' }))
      .then(value => { settled = true; return value })
    request.result = 'saved'
    request.onsuccess?.()
    await Promise.resolve()
    assert.equal(settled, false)
    transaction.oncomplete()
    assert.equal(await result, 'saved')
  })

  test(`${operation} rejects an abort after request success`, async () => {
    const { database, transaction, request } = controlledDatabase()
    const result = operation === 'get'
      ? indexedDBGet(database, 'resources', 'notes')
      : indexedDBPut(database, 'resources', { key: 'notes' })
    const failure = new Error('transaction aborted')
    const rejected = assert.rejects(result, error => error === failure)
    request.onsuccess?.()
    transaction.error = failure
    transaction.onabort?.()
    await rejected
  })
}

function controlledDatabase() {
  const request = {}
  const transaction = { objectStore: () => ({ get: () => request, put: () => request }) }
  return { database: { transaction: () => transaction }, transaction, request }
}
