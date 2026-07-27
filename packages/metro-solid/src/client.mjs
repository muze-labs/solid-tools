import metro from '@muze-nl/metro'
import oldm from '@muze-nl/oldm'
import oldmmw from '@muze-nl/metro-oldm'
import { from } from '@muze-nl/jaqt'
import * as assert from '@muze-nl/assert'
import { allOf, validURL } from '@muze-nl/assert'

const BASIC_CONTAINER = 'http://www.w3.org/ns/ldp#BasicContainer'
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

export function solidApi(base, methods) {
  const linkedData = oldmmw()

  return new metro.API(metro.client(
    base,
    linkedData,
    metro.mw.thrower(),
    metro.mw.getdata({
      alwaysData: true,
      responseProperty: SOLID_RESPONSE
    })
  ), {
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
      const response = result[SOLID_RESPONSE]
      return {
        response,
        location: response.headers.get('Location'),
        etag: response.headers.get('ETag')
      }
    },

    async contains(url, options = {}) {
      const headers = new Headers(options.headers)
      if (!headers.has('Accept')) {
        headers.set('Accept', 'text/turtle')
      }
      const result = await this.get(ensureSlash(url), {
        ...options,
        headers
      })
      const response = result[SOLID_RESPONSE]

      return from(oldm.many(result?.primary?.ldp$contains))
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
        headers.set('Accept', 'text/turtle')
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
      const storageUrls = [...new Set(from(ids(profile.pim$storage))
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
      const storage = [...new Set(from(ids(profile.pim$storage))
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

    ...methods,
    oldm: linkedData.context
  })
}
