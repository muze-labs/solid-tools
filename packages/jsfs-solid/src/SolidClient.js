import * as jsfsModule from '@muze-nl/jsfs'
import { lading } from '@muze-labs/lading'
import SolidAdapter from './SolidAdapter.js'
import { createSolidMetroClient, oidcIdToken } from './metro.mjs'

function jsfsApi() {
  return jsfsModule.default ?? jsfsModule.jsfs ?? globalThis.jsfs ?? null
}

function createFilesystem(adapter) {
  const jsfs = jsfsApi()
  if (jsfs?.fs) {
    return new jsfs.fs(adapter)
  }
  return adapter
}

function ensureOptions(options) {
  return options ? { ...options } : {}
}

export default async function solidClient(webId, options = {}) {
  if (!webId) {
    throw new TypeError('solidClient: webId is required')
  }

  const discoveryOptions = ensureOptions(options)
  const discoveryMetro = createSolidMetroClient(webId, {
    ...discoveryOptions,
    oidc: discoveryOptions.discoveryOidc ?? false,
    oldm: true
  })
  const discoverySolid = lading(discoveryMetro)
  const profileInfo = await discoverySolid.discoverWebId(webId)

  if (!profileInfo.profile) {
    throw new Error(`solidClient: ${webId} did not return a parsed Solid profile`)
  }

  const issuer = options.issuer ?? profileInfo.issuer
  const clientOptions = {
    ...options,
    issuer
  }
  const metroClient = createSolidMetroClient(webId, clientOptions)
  const solid = lading(metroClient)

  const storage = profileInfo.storage.map(storageUrl => {
    const adapter = new SolidAdapter(storageUrl, '/', {
      ...clientOptions,
      metroClient
    })
    return createFilesystem(adapter)
  })

  const client = {
    webId,
    profile: profileInfo.profile,
    issuer,
    inbox: profileInfo.inbox,
    storage,
    metro: metroClient,
    solid,

    id() {
      return oidcIdToken(this.issuer)
    },

    async logout() {
      throw new Error('solidClient.logout: not yet implemented')
    }
  }

  for (const method of ['get', 'head', 'post', 'put', 'patch', 'delete']) {
    if (typeof metroClient[method] === 'function') {
      client[method] = metroClient[method].bind(metroClient)
    }
  }

  return client
}
