export const packageName = '@muze-labs/solid-workspace'

export function workspace() {
  throw new Error('solid-workspace: not implemented yet')
}

export function collection() {
  throw new Error('solid-workspace: collection is not implemented yet')
}

export const solid = {
  resource(url, options = {}) {
    return { kind: 'resource', url, ...options }
  },
  container(url, options = {}) {
    return { kind: 'container', url, ...options }
  }
}
