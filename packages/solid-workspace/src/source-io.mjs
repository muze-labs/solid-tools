import oldm from '@muze-nl/oldm'
import { copyGraph, emptyGraph, parseGraph } from './graphs.mjs'
import { errorStatus } from './status.mjs'

// Translates native graph reads/writes to source adapters or the Solid client.
// It does not publish working graphs or decide replica/save state transitions.
export class SourceIO {
  constructor(solid, workspace) {
    this.solid = solid
    // Forward the existing adapter context; transport never reads its state.
    this.workspace = workspace
  }

  contains(source) {
    assertSolidClient(this.solid)
    return this.solid.contains(source.url, source.options)
  }

  async read(source, options = {}) {
    if (source.kind !== 'resource') {
      throw new Error('solid-workspace: graphs can only be loaded from resource sources')
    }

    if (typeof source.load === 'function') {
      const turtle = await source.load({
        source, workspace: this.workspace, ...options.readOptions
      })
      return parseGraph(turtle, source)
    }

    assertSolidClient(this.solid)
    try {
      const response = await this.solid.get(source.url, requestOptions({
        ...source.options,
        ...options.readOptions
      }))

      if (response instanceof oldm.Graph) {
        return copyGraph(response, { url: source.url })
      }
      return parseGraph(response, source)
    }
    catch (error) {
      const status = errorStatus(error)
      if (status === 404 || status === 410) {
        return emptyGraph(source)
      }
      throw error
    }
  }

  async write(source, snapshot, options = {}) {
    if (typeof source.save === 'function') {
      const result = await source.save(await this.serialize(source, snapshot), {
        source,
        workspace: this.workspace,
        ...options
      })
      if (result?.ok === false) {
        throw result.error ?? new Error('solid-workspace: source save failed', { cause: result })
      }
      return result
    }

    assertSolidClient(this.solid)
    const response = await this.solid.put(source.url, bodyOptions(await this.serialize(source, snapshot), writeOptions(source, options)))
    assertWriteSucceeded(response)
    return response
  }

  async create(source, snapshot, options = {}) {
    assertSolidClient(this.solid)
    const turtle = await this.serialize(source, snapshot)
    const request = writeOptions(source, options)
    const response = source.createContainer
      ? await this.solid.postToContainer(source.createContainer, turtle, request)
      : await this.solid.create(source.url, turtle, request)
    assertWriteSucceeded(response)
    return response
  }

  serialize(source, snapshot) {
    const output = source.prefixes ? copyGraph(snapshot, {
      prefixes: { ...snapshot.prefixDeclarations(), ...source.prefixes }
    }) : snapshot
    return output.write()
  }

  async remove(url, options = {}) {
    assertSolidClient(this.solid)
    const response = await this.solid.delete(url, requestOptions(options))
    assertWriteSucceeded(response)
    return response
  }
}

function assertWriteSucceeded(response) {
  if (response?.ok === false) {
    throw new Error(
      `solid-workspace: remote save failed (${response.status})`,
      { cause: response }
    )
  }
}

function assertSolidClient(solid) {
  if (!solid) {
    throw new TypeError('solid-workspace: a Solid API client is required for Solid sources')
  }
}

function writeOptions(source, options) {
  const headers = new Headers(source?.writeOptions?.headers)
  for (const [key, value] of new Headers(options?.headers)) {
    headers.set(key, value)
  }
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'text/turtle')
  }

  return {
    ...source?.writeOptions,
    ...options,
    headers
  }
}

function requestOptions(options = {}) {
  return {
    ...options,
    headers: new Headers(options.headers)
  }
}

function bodyOptions(body, options = {}) {
  return {
    ...options,
    body,
    headers: new Headers(options.headers)
  }
}
