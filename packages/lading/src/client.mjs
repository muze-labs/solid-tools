import metro from '@muze-nl/metro'
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

function withThrower(client, options = {}) {
  if (options.thrower === false || !client || typeof client.with !== 'function') {
    return client
  }
  return client.with(metro.mw.thrower(options.thrower))
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
    if (!profile) {
      return []
    }

    return ids(profile.space$storage ?? profile.pim$storage ?? profile.solid$storage)
      .map(url => ensureSlash(url))
      .map(url => ({ id: url, url, response }))
  }

  async discoverWebId(webId, options = {}) {
    const { profile, response } = await this.discoverProfile(webId, options)
    if (!profile) {
      return { webId, profile: null, storage: [], issuer: null, inbox: null, response }
    }

    return {
      webId,
      profile,
      storage: ids(profile.space$storage ?? profile.pim$storage ?? profile.solid$storage).map(ensureSlash),
      issuer: ids(profile.solid$oidcIssuer)[0] ?? null,
      inbox: ids(profile.ldp$inbox)[0] ?? null,
      response
    }
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
    return this.client.metro.put(this.url, bodyOptions(options.body ?? '', {
      ...options,
      headers: containerHeaders(options)
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
