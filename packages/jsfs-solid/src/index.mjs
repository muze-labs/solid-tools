import * as jsfsModule from '@muze-nl/jsfs'
import SolidAdapter from './SolidAdapter.js'

function jsfsApi() {
  return jsfsModule.default ?? jsfsModule.jsfs ?? globalThis.jsfs ?? null
}

function adapterInput(rootUrl, options = {}) {
  if (typeof rootUrl === 'object' && rootUrl !== null) {
    return {
      rootUrl: rootUrl.rootUrl,
      path: rootUrl.path ?? '/',
      options: { ...rootUrl, ...options }
    }
  }

  return {
    rootUrl,
    path: options.path ?? '/',
    options
  }
}

export function createSolidAdapter(rootUrl, options = {}) {
  const input = adapterInput(rootUrl, options)
  return new SolidAdapter(input.rootUrl, input.path, input.options)
}

export function solidFs(rootUrl, options = {}) {
  const adapter = createSolidAdapter(rootUrl, options)
  const jsfs = jsfsApi()
  if (jsfs?.fs) {
    return new jsfs.fs(adapter)
  }
  return adapter
}

export { SolidAdapter }
export { createSolidMetroClient, oidcIdToken } from './metro.mjs'
export { filename, isAbsoluteUrl, joinPath, normalizePath, pathFromUrl, resolveSolidUrl } from './paths.mjs'

export default {
  SolidAdapter,
  createSolidAdapter,
  solidFs
}
