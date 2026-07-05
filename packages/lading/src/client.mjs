let metro = null

try {
  const imported = await import('@muze-nl/metro')
  metro = imported.default ?? imported
} catch {
  metro = null
}

import {
  containerHeaders,
  getETag,
  getLocation,
  solidRequestHeaders
} from './headers.mjs'

const LINKED_DATA_ACCEPT = 'text/turtle, application/ld+json;q=0.9, */*;q=0.1'
const CONTAINER_ACCEPT = 'text/turtle, application/ld+json;q=0.9, */*;q=0.1'

function ensureSlash(url) {
  return String(url).endsWith('/') ? String(url) : `${url}/`
}

function values(value) {
  if (value == null) {
    return []
  }
  return Array.isArray(value) ? value : [value]
}

function ids(value) {
  return values(value)
    .map(item => typeof item === 'string' ? item : item?.id)
    .filter(Boolean)
}

function unique(items) {
  return [...new Set(items)]
}

export function storageUrlsFromProfile(profile) {
  if (!profile) {
    return []
  }

  return unique([
    ...ids(profile.space$storage),
    ...ids(profile.pim$storage),
    ...ids(profile.solid$storage)
  ].map(ensureSlash))
}

export function storageFromProfile(profile, options = {}) {
  return storageUrlsFromProfile(profile).map(url => ({
    profile,
    response: options.response ?? null,
    id: url,
    url
  }))
}

function throwerFactory(options = {}) {
  if (options.thrower === false) {
    return null
  }
  if (typeof options.thrower === 'function') {
    return options.thrower
  }
  return metro?.mw?.thrower ?? null
}

function withThrower(client, options = {}) {
  const createThrower = throwerFactory(options)
  if (!createThrower || !client || typeof client.with !== 'function') {
    return client
  }
  return client.with(createThrower(options.thrower))
}

function bodyOptions(body, options = {}) {
  return {
    ...options,
    body,
    headers: solidRequestHeaders(options)
  }
}

function requestOptions(options = {}) {
  return {
    ...options,
    headers: solidRequestHeaders(options)
  }
}

function safeCreateOptions(options = {}) {
  if (Object.hasOwn(options, 'ifNoneMatch')) {
    return options
  }
  return {
    ...options,
    ifNoneMatch: '*'
  }
}

export class LadingClient {
  constructor(metroClient, options = {}) {
    if (!metroClient) {
      throw new TypeError('lading: metro client is required')
    }
    this.metro = withThrower(metroClient, options)
    this.options = options
  }

  resource(url) {
    return new SolidResource(this, url)
  }

  container(url) {
    return new SolidContainer(this, url)
  }

  async discoverProfile(webId, options = {}) {
    const response = await this.resource(webId).get({
      accept: LINKED_DATA_ACCEPT,
      ...options
    })

    return {
      response,
      profile: response?.data?.primary ?? null
    }
  }

  async discoverStorage(webId, options = {}) {
    const { profile, response } = await this.discoverProfile(webId, options)
    return storageFromProfile(profile, { response })
  }

  async discoverWebId(webId, options = {}) {
    const { profile, response } = await this.discoverProfile(webId, options)
    if (!profile) {
      return { webId, profile: null, storage: [], issuer: null, inbox: null, response }
    }

    return {
      webId,
      profile,
      storage: storageUrlsFromProfile(profile),
      issuer: ids(profile.solid$oidcIssuer)[0] ?? null,
      inbox: ids(profile.ldp$inbox)[0] ?? null,
      response
    }
  }

  storageFromProfile(profile, options = {}) {
    return storageFromProfile(profile, options)
  }
}

export class SolidResource {
  constructor(client, url) {
    this.client = client
    this.url = String(url)
  }

  get(options = {}) {
    return this.client.metro.get(this.url, requestOptions(options))
  }

  head(options = {}) {
    return this.client.metro.head(this.url, requestOptions(options))
  }

  put(body, options = {}) {
    return this.client.metro.put(this.url, bodyOptions(body, options))
  }

  create(body, options = {}) {
    return this.put(body, safeCreateOptions(options))
  }

  patch(body, options = {}) {
    return this.client.metro.patch(this.url, bodyOptions(body, options))
  }

  delete(options = {}) {
    return this.client.metro.delete(this.url, requestOptions(options))
  }
}

export class SolidContainer extends SolidResource {
  constructor(client, url) {
    super(client, ensureSlash(url))
  }

  get(options = {}) {
    return this.client.metro.get(this.url, requestOptions({
      accept: CONTAINER_ACCEPT,
      ...options
    }))
  }

  create(options = {}) {
    const createOptions = safeCreateOptions(options)
    return this.client.metro.put(this.url, bodyOptions(createOptions.body ?? '', {
      ...createOptions,
      headers: containerHeaders(createOptions)
    }))
  }

  async post(body, options = {}) {
    const response = await this.client.metro.post(this.url, bodyOptions(body, options))
    return {
      response,
      location: getLocation(response),
      etag: getETag(response)
    }
  }

  async contains(options = {}) {
    const response = await this.get(options)
    const contains = values(response?.data?.primary?.ldp$contains)
    return contains
      .map(resource => {
        const id = typeof resource === 'string' ? resource : resource?.id
        return id ? { id, url: id, resource, response } : null
      })
      .filter(Boolean)
  }
}

export function lading(metroClient, options = {}) {
  return new LadingClient(metroClient, options)
}

export const createLadingClient = lading
