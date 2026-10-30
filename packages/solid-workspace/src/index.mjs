export const packageName = '@muze-labs/solid-workspace'

export { collection, WorkspaceCollection } from './collection.mjs'
export { graph, resource, solid } from './sources.mjs'
export { SolidWorkspace, workspace } from './workspace.mjs'
export { local } from './local.mjs'

import { collection } from './collection.mjs'
import { local } from './local.mjs'
import { graph, resource, solid } from './sources.mjs'
import { workspace } from './workspace.mjs'

export default {
  packageName,
  workspace,
  collection,
  resource,
  graph,
  local,
  solid
}
