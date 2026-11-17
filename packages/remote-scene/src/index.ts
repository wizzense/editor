import type { Plugin } from '@pascal-app/core'
import { extElementNodeDefinition } from './kinds/ext-element'

export { activeSceneSync, onActiveSceneSync, setActiveSceneSync } from './active'
export { applyRemoteGraphAsAgent, applyRemoteNodes, isApplyingRemoteNodes } from './apply'
export { type DiffResult, diffNodesToOps } from './diff'
export {
  type EventSourceFactory,
  type EventSourceLike,
  type FetchLike,
  parseOpsFrame,
  SceneHostClient,
} from './host-client'
export { extElementDefinition, extElementExtents } from './kinds/ext-element'
export {
  EXT_ELEMENT_SCHEMA_VERSION,
  ExtElementNode,
  migrateExtElement,
} from './kinds/ext-element-schema'
export { toast } from './notify'
export type {
  Author,
  NodeOp,
  OpResult,
  OpsDiff,
  OpsFrame,
  OpsResponse,
  SaveResponse,
  SceneDoc,
  SceneNode,
  SceneOp,
} from './ops'
export { createStorePort } from './store-port'
export {
  type Notify,
  RemoteSceneSync,
  type RemoteSceneSyncOptions,
  type ScenePort,
  type SyncStatus,
} from './sync'

export const REMOTE_SCENE_PLUGIN_ID = 'pascal:remote-scene'

/** The plugin that brings the host-owned element kind and its inspector. */
export const remoteScenePlugin: Plugin = {
  id: REMOTE_SCENE_PLUGIN_ID,
  apiVersion: 1,
  nodes: [extElementNodeDefinition],
}
