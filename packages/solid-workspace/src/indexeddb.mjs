import oldm from '@muze-nl/oldm'

export function openIndexedDatabase({ indexedDB, name, version, storeName }) {
  const factory = indexedDB ?? globalThis.indexedDB
  if (!factory) {
    throw new TypeError('solid-workspace: IndexedDB is not available')
  }

  return new Promise((resolve, reject) => {
    const request = factory.open(name, version)
    request.onerror = () => reject(request.error ?? new Error(`solid-workspace: could not open IndexedDB database ${name}`))
    request.onblocked = () => reject(new Error(`solid-workspace: IndexedDB database ${name} is blocked`))
    request.onupgradeneeded = () => {
      const database = request.result
      if (!objectStoreExists(database.objectStoreNames, storeName)) {
        database.createObjectStore(storeName, { keyPath: 'key' })
      }
    }
    request.onsuccess = () => resolve(request.result)
  })
}

export function indexedDBGet(database, storeName, key) {
  return indexedDBRequest(
    database.transaction(storeName, 'readonly').objectStore(storeName).get(key)
  )
}

export function indexedDBPut(database, storeName, value) {
  return indexedDBRequest(
    database.transaction(storeName, 'readwrite').objectStore(storeName).put(value)
  )
}

function indexedDBRequest(request) {
  return new Promise((resolve, reject) => {
    request.onerror = () => reject(request.error ?? new Error('solid-workspace: IndexedDB request failed'))
    request.onsuccess = () => resolve(request.result)
  })
}

function objectStoreExists(objectStoreNames, storeName) {
  if (typeof objectStoreNames?.contains === 'function') {
    return objectStoreNames.contains(storeName)
  }

  return oldm.many(objectStoreNames).includes(storeName)
}
