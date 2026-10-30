import {
  indexedDBGet, indexedDBPut, openIndexedDatabase
} from './indexeddb.mjs'
import { graphResource } from './sources.mjs'

function turtleText(value) {
  if (typeof value !== 'string') {
    throw new TypeError('solid-workspace: local sources store Turtle text')
  }
  return value
}

export const local = {
  memory(id, options = {}) {
    if (typeof id !== 'string' || !id) {
      throw new TypeError('solid-workspace: memory source id must be a string')
    }
    const url = options.url ?? `memory://${encodeURIComponent(id)}`
    let turtle = turtleText(options.turtle ?? '')
    return graphResource({
      ...options, id, url, local: true, type: 'local-memory',
      async load() {
        return turtle
      },
      async save(value) {
        turtle = turtleText(value)
        return { ok: true, status: 'saved', sourceUrl: url }
      }
    })
  },

  indexedDB(name, options = {}) {
    if (typeof name !== 'string' || !name) {
      throw new TypeError('solid-workspace: IndexedDB database name is required')
    }
    const storeName = options.store ?? 'resources'
    const key = options.key ?? options.id ?? 'default'
    const id = options.id ?? `${name}:${key}`
    const url = options.url ?? `indexeddb://${encodeURIComponent(name)}/${encodeURIComponent(storeName)}/${encodeURIComponent(key)}`
    const initialTurtle = turtleText(options.turtle ?? '')
    const {
      indexedDB, databaseVersion = 1, ...sourceOptions
    } = options

    async function database() {
      return openIndexedDatabase({
        indexedDB, name, version: databaseVersion, storeName
      })
    }

    return graphResource({
      ...sourceOptions, id, url, local: true, type: 'local-indexeddb',
      async load() {
        const db = await database()
        try {
          const entry = await indexedDBGet(db, storeName, key)
          return entry ? turtleText(entry.turtle) : initialTurtle
        }
        finally {
          db.close?.()
        }
      },
      async save(value) {
        const turtle = turtleText(value)
        const db = await database()
        try {
          await indexedDBPut(db, storeName, {
            key, turtle, updatedAt: new Date().toISOString()
          })
        }
        finally {
          db.close?.()
        }
        return { ok: true, status: 'saved', sourceUrl: url }
      }
    })
  }
}
