import jsfsSolid, { SolidAdapter, createSolidAdapter, solidFs } from './index.mjs'

export { SolidAdapter, createSolidAdapter, solidFs }
export default jsfsSolid

globalThis.jsfsSolid = jsfsSolid
globalThis.SolidAdapter = SolidAdapter
