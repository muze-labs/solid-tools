import HttpAdapter from '@muze-nl/jsfs/src/Adapters/Http.mjs'
import { lading } from '@muze-labs/lading'
import { createSolidMetroClient } from './metro.mjs'
import { filename, isAbsoluteUrl, pathFromUrl, resolveSolidUrl } from './paths.mjs'

function readContentType(response) {
  if (response?.headers?.get) {
    return response.headers.get('Content-Type') ?? response.headers.get('content-type') ?? 'application/octet-stream'
  }
  return response?.headers?.['Content-Type'] ?? response?.headers?.['content-type'] ?? 'application/octet-stream'
}

function isTextLike(type) {
  return /^text\//.test(type) || /\b(json|xml|javascript|turtle|ld\+json)\b/.test(type)
}

function isJsonLike(type) {
  return /\bjson\b|ld\+json/.test(type)
}

function many(value) {
  if (value == null) {
    return []
  }
  return Array.isArray(value) ? value : [value]
}

function hasType(resource, type) {
  return many(resource?.a).includes(type)
}

export default class SolidAdapter extends HttpAdapter {
  #rootUrl
  #basePath
  #metro
  #solid

  constructor(rootUrl, path = '/', options = {}) {
    if (typeof path === 'object' && path !== null) {
      options = path
      path = options.path ?? '/'
    }

    if (!rootUrl && !options.rootUrl) {
      throw new TypeError('SolidAdapter: rootUrl is required')
    }

    const actualRootUrl = rootUrl ?? options.rootUrl
    const metroClient = createSolidMetroClient(actualRootUrl, options)

    super(metroClient, path)

    this.#rootUrl = String(actualRootUrl)
    this.#basePath = path
    this.#metro = metroClient
    this.#solid = options.solid ?? lading(metroClient)
  }

  get name() {
    return 'SolidAdapter'
  }

  get rootUrl() {
    return this.#rootUrl
  }

  get metro() {
    return this.#metro
  }

  get solid() {
    return this.#solid
  }

  supportsDirectories() {
    return true
  }

  url(path = '/') {
    return resolveSolidUrl(this.#rootUrl, this.#basePath, path)
  }

  async read(path = '/') {
    const url = this.url(path)
    const response = await this.#solid.resource(url).get()
    const type = readContentType(response)

    const result = {
      type,
      name: filename(path),
      http: {
        headers: response.headers,
        status: response.status,
        url: response.url ?? url
      }
    }

    if (response.data) {
      result.data = response.data
    }

    if (isJsonLike(type) && typeof response.json === 'function') {
      result.contents = await response.json()
    } else if (isTextLike(type) && typeof response.text === 'function') {
      result.contents = await response.text()
    } else if (typeof response.blob === 'function') {
      result.contents = await response.blob()
    } else {
      result.contents = response.body ?? response.data ?? null
    }

    return result
  }

  async write(path, contents, metadata = {}) {
    const url = this.url(path)
    const response = await this.#solid.resource(url).put(contents, {
      contentType: metadata.type ?? metadata.contentType,
      ifMatch: metadata.ifMatch,
      ifNoneMatch: metadata.ifNoneMatch,
      headers: metadata.headers
    })

    return {
      type: metadata.type ?? metadata.contentType,
      name: filename(path),
      http: {
        headers: response.headers,
        status: response.status,
        url: response.url ?? url
      }
    }
  }

  async remove(path) {
    return this.#solid.resource(this.url(path)).delete()
  }

  async delete(path) {
    return this.remove(path)
  }

  async list(path = '/') {
    const url = this.url(path)
    const entries = await this.#solid.container(url).contains()

    return entries.map(entry => {
      const resource = entry.resource
      const entryUrl = isAbsoluteUrl(entry.id) ? entry.id : new URL(entry.id, url).href
      const path = pathFromUrl(this.#rootUrl, entryUrl)
      const isContainer = hasType(resource, 'ldp$Container') || entryUrl.endsWith('/')

      return {
        filename: filename(entryUrl),
        path,
        url: entryUrl,
        type: isContainer ? 'folder' : 'file',
        resource
      }
    })
  }

  async mkdir(path = '/') {
    return this.#solid.container(this.url(path)).create()
  }

  async rmdir(path = '/') {
    return this.#solid.container(this.url(path)).delete()
  }
}
