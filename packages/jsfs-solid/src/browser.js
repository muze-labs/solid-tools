import jsfsSolid, {
  SolidAdapter,
  authorizePopup,
  createSolidAdapter,
  popupHandleRedirect,
  solidFs
} from './index.mjs'

export { SolidAdapter, authorizePopup, createSolidAdapter, popupHandleRedirect, solidFs }
export default jsfsSolid

globalThis.jsfsSolid = jsfsSolid
globalThis.SolidAdapter = SolidAdapter
