import SolidAdapter from './SolidAdapter.js'
import solidClient from './SolidClient.js'

const jsfsSolid = {
  adapter: SolidAdapter,
  client: solidClient,
  solidClient,
  SolidAdapter
}

export { SolidAdapter, solidClient }
export default jsfsSolid

globalThis.jsfsSolid = jsfsSolid
globalThis.solidClient = solidClient
globalThis.SolidAdapter = SolidAdapter
