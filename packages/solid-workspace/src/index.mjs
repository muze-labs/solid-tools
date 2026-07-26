export const packageName = '@muze-labs/solid-workspace'

export { collection, WorkspaceCollection } from './collection.mjs'
export {
  graph,
  resource,
  solid,
  SolidWorkspace,
  workspace
} from './workspace.mjs'
export { local } from './local.mjs'
export { mergeGraphDocuments } from './graph-document.mjs'

import { collection } from './collection.mjs'
import { mergeGraphDocuments } from './graph-document.mjs'
import { local } from './local.mjs'
import {
  graph,
  resource,
  solid,
  workspace
} from './workspace.mjs'

export default {
  packageName,
  workspace,
  collection,
  resource,
  mergeGraphDocuments,
  graph,
  local,
  solid
}
