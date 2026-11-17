/**
 * `pascal-engine-bridge/1`: the postMessage protocol between the editor and an engine page docked in an
 * Engine view. Requests carry an `id`; a reply carries `re` = that id. Geometry never crosses this bridge:
 * both sides follow the scene host's event stream.
 */
export const BRIDGE_PROTO = 'pascal-engine-bridge/1' as const

export type Vec3 = [number, number, number]

export type CameraPose = { p: Vec3; t: Vec3; fov: number }

export type RoleInfo = { id: string; label: string; swatch: string }

export type EngineCapability = 'select' | 'time' | 'play' | 'pose' | 'describe'

/** Editor → engine. */
export type EditorToEngine = {
  hello: { sceneUrl: string }
  select: { ids: string[] }
  time: { seq: string; f: number }
  play: { seq: string; from: number; to?: number; rate?: number }
  stop: Record<string, never>
  /** Requests end in `?`; the reply drops it. */
  'pose?': Record<string, never>
  'describe?': Record<string, never>
}

/** Engine → editor (replies and unasked messages). */
export type EngineToEditor = {
  ready: { version: number; sceneId: string; caps: EngineCapability[] }
  selected: { ids: string[] }
  tick: { f: number }
  stopped: { f: number }
  pose: CameraPose
  describe: { roles: RoleInfo[]; kinds: string[] }
  version: { version: number }
}

export type BridgeMessageType = keyof EditorToEngine | keyof EngineToEditor

export type Envelope<T extends string = string, F = Record<string, unknown>> = {
  proto: typeof BRIDGE_PROTO
  id: string | null
  type: T
  re?: string
} & F

/** The reply each request expects. */
export type ReplyTypeOf = {
  hello: 'ready'
  stop: 'stopped'
  'pose?': 'pose'
  'describe?': 'describe'
}

export function isEnvelope(value: unknown): value is Envelope {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    v.proto === BRIDGE_PROTO &&
    typeof v.type === 'string' &&
    (v.id === null || typeof v.id === 'string') &&
    (v.re === undefined || typeof v.re === 'string')
  )
}

export function makeEnvelope<T extends string, F extends object>(
  type: T,
  fields: F,
  id: string | null = null,
  re?: string,
): Envelope<T, F> {
  return {
    ...fields,
    proto: BRIDGE_PROTO,
    id,
    type,
    ...(re === undefined ? {} : { re }),
  } as Envelope<T, F>
}
