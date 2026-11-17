export {
  type AttachableEngineAdapter,
  createEngineAdapter,
  type EngineAdapter,
  type EngineDescription,
  type EngineReady,
  engineAdapter,
} from './adapter'
export { configureEngineView, type EngineViewConfig, engineViewSrc } from './engine-view-config'
export {
  BRIDGE_PROTO,
  type CameraPose,
  type EditorToEngine,
  type EngineCapability,
  type EngineToEditor,
  type Envelope,
  isEnvelope,
  makeEnvelope,
  type RoleInfo,
  type Vec3,
} from './protocol'
export {
  type Bridge,
  type BridgeClock,
  type BridgeOptions,
  BridgeTimeoutError,
  createBridge,
  type MessageSource,
  type PostTarget,
} from './transport'

/** The Engine host view: register it with `registerEditorHostView(engineHostView)`. */
export const engineHostView = {
  id: 'engine',
  label: 'Engine',
  icon: { kind: 'iconify', name: 'lucide:clapperboard' },
  component: () => import('./engine-view'),
  description: 'The docked engine page: it draws and plays the scene the editor is editing.',
  defaultPinned: true,
} as const
