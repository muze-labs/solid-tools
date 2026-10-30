// A failed operation must not poison the next one. Admission advances the
// revision synchronously, before a save waits behind any in-flight operation.
export class ResourceOperations {
  #operations
  #revisions

  constructor() {
    this.#operations = new Map()
    this.#revisions = new Map()
  }

  admit(key) {
    this.#revisions.set(key, this.revision(key) + 1)
  }

  revision(key) {
    return this.#revisions.get(key) ?? 0
  }

  sequence(key, operation) {
    const previous = this.#operations.get(key) ?? Promise.resolve()
    const current = previous.catch(() => {}).then(operation)
    this.#operations.set(key, current)
    current.finally(() => {
      if (this.#operations.get(key) === current) {
        this.#operations.delete(key)
      }
    }).catch(() => {})
    return current
  }
}
