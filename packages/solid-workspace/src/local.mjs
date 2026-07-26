import {
  cloneGraphDocument,
  graphDocumentFrom,
  graphDocumentFromTurtle,
  graphDocumentToTurtle
} from './graph-document.mjs'
import {
  indexedDBGet,
  indexedDBPut,
  openIndexedDatabase
} from './indexeddb.mjs'
import { graphResource } from './workspace.mjs'

export const local = {
  memory(idOrOptions, options = {}) {
    let config = { ...idOrOptions }
    if (typeof idOrOptions === 'string') {
      config = { ...options, id: idOrOptions }
    }

    const id = config.id ?? config.key ?? 'local-memory'
    const url = config.url ?? `memory://${encodeURIComponent(id)}`
    let initialDocument = config.document
    if (initialDocument == null) {
      initialDocument = {
        format: config.format ?? 'oldmed-graph',
        version: config.version ?? 1,
        prefixes: config.prefixes ?? {},
        subjects: []
      }
    }
    let turtle = config.turtle ?? null

    async function loadDocument() {
      if (turtle == null) {
        turtle = await graphDocumentToTurtle(initialDocument, {
          url,
          prefixes: config.prefixes
        })
      }
      return graphDocumentFromTurtle(turtle, {
        url,
        prefixes: config.prefixes
      })
    }

    return graphResource({
      ...config,
      id,
      url,
      local: true,
      type: 'local-memory',
      async load() {
        return cloneGraphDocument(await loadDocument())
      },
      async save(value) {
        const document = graphDocumentFrom(value)
        turtle = await graphDocumentToTurtle(document, {
          url,
          prefixes: config.prefixes
        })
        return {
          ok: true,
          status: 'saved',
          sourceUrl: url,
          document: cloneGraphDocument(document)
        }
      },
      async turtle() {
        await loadDocument()
        return turtle
      }
    })
  },
  indexedDB(nameOrOptions, options = {}) {
    let config = { ...nameOrOptions }
    if (typeof nameOrOptions === 'string') {
      config = { ...options, name: nameOrOptions }
    }

    const databaseName = config.name ?? config.databaseName ?? config.database
    if (!databaseName) {
      throw new TypeError('solid-workspace: IndexedDB database name is required')
    }

    const storeName = config.store ?? config.storeName ?? 'resources'
    const key = config.key ?? config.id ?? 'default'
    const id = config.id ?? `${databaseName}:${key}`
    const url = config.url ?? `indexeddb://${encodeURIComponent(databaseName)}/${encodeURIComponent(storeName)}/${encodeURIComponent(key)}`
    const databaseVersion = config.databaseVersion ?? 1
    const initialDocument = config.document === undefined ? null : graphDocumentFrom(config.document)
    const initialTurtle = config.turtle ?? null
    const indexedDBFactory = config.indexedDB
    const sourceConfig = { ...config }
    delete sourceConfig.indexedDB
    delete sourceConfig.document
    delete sourceConfig.turtle
    delete sourceConfig.databaseVersion

    async function loadTurtle() {
      const database = await openIndexedDatabase({
        indexedDB: indexedDBFactory,
        name: databaseName,
        version: databaseVersion,
        storeName
      })
      try {
        const entry = await indexedDBGet(database, storeName, key)
        if (entry?.turtle) {
          return entry.turtle
        }
        if (initialTurtle != null) {
          return initialTurtle
        }
        return graphDocumentToTurtle(initialDocument, {
          url,
          prefixes: config.prefixes
        })
      } finally {
        database.close?.()
      }
    }

    return graphResource({
      ...sourceConfig,
      id,
      url,
      local: true,
      type: 'local-indexeddb',
      async load() {
        return cloneGraphDocument(graphDocumentFromTurtle(await loadTurtle(), {
          url,
          prefixes: config.prefixes
        }))
      },
      async save(value) {
        const document = graphDocumentFrom(value)
        const turtle = await graphDocumentToTurtle(document, {
          url,
          prefixes: config.prefixes
        })
        const database = await openIndexedDatabase({
          indexedDB: indexedDBFactory,
          name: databaseName,
          version: databaseVersion,
          storeName
        })
        try {
          await indexedDBPut(database, storeName, {
            key,
            turtle,
            updatedAt: new Date().toISOString()
          })
        } finally {
          database.close?.()
        }
        return {
          ok: true,
          status: 'saved',
          sourceUrl: url,
          document: cloneGraphDocument(document)
        }
      },
      async turtle() {
        return loadTurtle()
      }
    })
  }
}
