import metro from '@muze-nl/metro'
import oldm from '@muze-nl/oldm'
import oldmmw from '@muze-nl/metro-oldm'
import { from } from '@muze-nl/jaqt'
import * as assert from '@muze-nl/assert'
import { allOf, validURL } from '@muze-nl/assert'

const BASIC_CONTAINER = 'http://www.w3.org/ns/ldp#BasicContainer'
const LINKED_DATA_ACCEPT = 'text/turtle, application/ld+json;q=0.9, */*;q=0.1'
const CONTAINER_ACCEPT = 'text/turtle, application/ld+json;q=0.9, */*;q=0.1'
const SOLID_OLDM_MIDDLEWARE = Symbol.for('muze.metro-solid.oldmMiddleware')
const SOLID_METADATA_MIDDLEWARE = Symbol.for('muze.metro-solid.metadataMiddleware')
const SOLID_RESPONSE = Symbol.for('muze.metro-solid.response')

function ensureSlash(url) {
  return String(url).endsWith('/') ? String(url) : `${url}/`
}

function ids(value) {
  return from(oldm.many(value))
    .select(item => typeof item === 'string' ? item : item?.id)
    .where(Boolean)
    .toArray()
}

function solidResponseMetadataMiddleware() {
  async function solidResponseMetadata(req, next) {
    const response = await next(req)
    const data = response?.data

    if (data && (typeof data === 'object' || typeof data === 'function') && !data[SOLID_RESPONSE]) {
      Object.defineProperty(data, SOLID_RESPONSE, {
        value: response,
        enumerable: false,
        configurable: true
      })
    }

    return response
  }
  solidResponseMetadata[SOLID_METADATA_MIDDLEWARE] = true
  return solidResponseMetadata
}

export class SolidAPI extends metro.API {
  constructor(base, methods = {}, bind = null) {
    if (!base) {
      throw new TypeError('metro-solid: base URL or Metro client is required')
    }
    if (!methods || typeof methods !== 'object') {
      throw new TypeError('metro-solid: API methods must be an object')
    }

    let client = base
    const middlewares = []

    if (base instanceof metro.Client) {
      if (!base.clientOptions.middlewares?.some(middleware => (
        middleware?.[SOLID_OLDM_MIDDLEWARE] === true
        || middleware?.name === 'oldmmw'
      ))) {
        const oldmMiddleware = oldmmw()
        oldmMiddleware[SOLID_OLDM_MIDDLEWARE] = true
        middlewares.push(oldmMiddleware)
      }
      if (!base.clientOptions.middlewares?.some(middleware => (
        middleware?.[SOLID_METADATA_MIDDLEWARE] === true
        || middleware?.name === 'solidResponseMetadata'
      ))) {
        middlewares.push(solidResponseMetadataMiddleware())
      }
      if (middlewares.length > 0) {
        client = base.with(...middlewares)
      }
    } else {
      const oldmMiddleware = oldmmw()
      oldmMiddleware[SOLID_OLDM_MIDDLEWARE] = true
      client = metro.client(base, oldmMiddleware, solidResponseMetadataMiddleware())
    }

    super(client, {
      create(url, body, options = {}) {
        const headers = new Headers(options.headers)
        if (!headers.has('If-None-Match')) {
          headers.set('If-None-Match', '*')
        }

        return this.put(String(url), {
          ...options,
          body,
          headers
        })
      },

      createContainer(url, options = {}) {
        const headers = new Headers(options.headers)
        if (!headers.has('If-None-Match')) {
          headers.set('If-None-Match', '*')
        }
        if (!headers.has('Link')) {
          headers.set('Link', `<${options.containerType ?? BASIC_CONTAINER}>; rel="type"`)
        }

        return this.put(ensureSlash(url), {
          ...options,
          body: options.body ?? '',
          headers
        })
      },

      async postToContainer(url, body, options = {}) {
        const result = await this.post(ensureSlash(url), {
          ...options,
          body,
          headers: new Headers(options.headers)
        })
        let response = result
        if (result?.data === undefined) {
          response = result?.[SOLID_RESPONSE] ?? result
        }
        const headers = response?.headers ?? {}
        const location = typeof headers.get === 'function' ? headers.get('Location') : headers.Location ?? headers.location ?? null
        const etag = typeof headers.get === 'function' ? headers.get('ETag') : headers.ETag ?? headers.etag ?? null

        return {
          response,
          location,
          etag
        }
      },

      async contains(url, options = {}) {
        const headers = new Headers(options.headers)
        if (!headers.has('Accept')) {
          headers.set('Accept', CONTAINER_ACCEPT)
        }
        const result = await this.get(ensureSlash(url), {
          ...options,
          headers
        })
        const data = result?.data ?? result
        let response = result
        if (result?.data === undefined) {
          response = result?.[SOLID_RESPONSE] ?? null
        }

        return from(oldm.many(data?.primary?.ldp$contains))
          .select(resource => {
            const id = typeof resource === 'string' ? resource : resource?.id
            return { id, url: id, resource, response }
          })
          .where(entry => entry.id)
          .toArray()
      },

      async discoverProfile(webId, options = {}) {
        const headers = new Headers(options.headers)
        if (!headers.has('Accept')) {
          headers.set('Accept', LINKED_DATA_ACCEPT)
        }
        const webIdIssues = assert.issues(webId, allOf(String, validURL))
        if (webIdIssues) {
          throw new TypeError(`metro-solid: webId must be a fully qualified URL: ${webIdIssues[0].message}`)
        }

        const subjectId = webId
        const result = await this.get(subjectId, {
          ...options,
          headers
        })
        const profile = result?.primary
        if (!profile?.id) {
          throw new Error(`metro-solid: WebID did not resolve to a profile subject: ${subjectId}`)
        }

        return profile
      },

      async discoverStorage(webId, options = {}) {
        const profile = await this.discoverProfile(webId, options)
        const storageUrls = [...new Set(from(ids(profile.pims$storage))
          .select(ensureSlash)
          .toArray())]

        return from(storageUrls)
          .select(url => ({
            profile,
            id: url,
            url
          }))
          .toArray()
      },

      async discoverWebId(webId, options = {}) {
        const profile = await this.discoverProfile(webId, options)
        const storage = [...new Set(from(ids(profile.pims$storage))
          .select(ensureSlash)
          .toArray())]

        return {
          webId,
          profile,
          storage,
          issuer: ids(profile.solid$oidcIssuer)[0] ?? null,
          inbox: ids(profile.ldp$inbox)[0] ?? null
        }
      },

      ...methods
    }, bind)
  }
}

export function solidApi(...options) {
  return new SolidAPI(...metro.deepClone(options))
}
