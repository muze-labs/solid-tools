import metro from '@muze-nl/metro'
import oidc from '@muze-nl/metro-oidc'
import { authorizePopup, popupHandleRedirect } from '@muze-nl/metro-oauth2'
import oldmmw from '@muze-nl/metro-oldm'

export function createSolidMetroClient(input, options = {}) {
  const providedClient = options.metroClient ?? options.metro ?? options.client
  let metroClient = providedClient ?? input

  if (!(metroClient instanceof metro.Client)) {
    metroClient = metro.client(metroClient)
  }

  // A provided Metro client is treated as already configured by default.
  // Pass configureMetro: true to explicitly add JSFS-Solid's middleware stack.
  if (providedClient && options.configureMetro !== true) {
    return metroClient
  }

  if (options.oidc !== false && oidc?.oidcmw && typeof metroClient?.with === 'function') {
    metroClient = metroClient.with(oidc.oidcmw(options))
  }

  if (options.oldm !== false && typeof oldmmw === 'function' && typeof metroClient?.with === 'function') {
    metroClient = metroClient.with(oldmmw(options))
  }

  return metroClient
}

export function oidcIdToken(issuer) {
  if (typeof oidc?.idToken === 'function') {
    return oidc.idToken(issuer)
  }
  return null
}

export { authorizePopup, popupHandleRedirect }
