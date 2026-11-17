import type { CameraPose, EngineCapability, Envelope, RoleInfo } from './protocol'
import type { Bridge } from './transport'

export type EngineReady = { version: number; sceneId: string; caps: EngineCapability[] }
export type EngineDescription = { roles: RoleInfo[]; kinds: string[] }

/**
 * What the editor asks of a docked engine. The Engine view attaches a bridge while it is mounted; with no
 * view open, fire-and-forget calls are dropped and the requests reject.
 */
export interface EngineAdapter {
  hello(sceneUrl: string): Promise<EngineReady>
  select(ids: string[]): void
  time(seq: string, f: number): void
  play(seq: string, from: number, to?: number, rate?: number): void
  stop(): Promise<number>
  pose(): Promise<CameraPose>
  describe(): Promise<EngineDescription>
  onSelected(fn: (ids: string[]) => void): () => void
  onTick(fn: (f: number, playing: boolean) => void): () => void
  onReady(fn: (ready: EngineReady) => void): () => void
  onVersion(fn: (version: number) => void): () => void
  /** Whether an engine page is docked and has said `ready`. */
  isReady(): boolean
}

export type AttachableEngineAdapter = EngineAdapter & {
  attach(bridge: Bridge): void
  detach(bridge?: Bridge): void
}

function pick<T>(message: Envelope, keys: (keyof T)[]): T {
  const out: Record<string, unknown> = {}
  for (const key of keys) out[key as string] = (message as Record<string, unknown>)[key as string]
  return out as T
}

export function createEngineAdapter(): AttachableEngineAdapter {
  let bridge: Bridge | null = null
  let ready: EngineReady | null = null
  let detachListeners: (() => void)[] = []
  let describeCache: Promise<EngineDescription> | null = null
  const selected = new Set<(ids: string[]) => void>()
  const ticks = new Set<(f: number, playing: boolean) => void>()
  const readies = new Set<(ready: EngineReady) => void>()
  const versions = new Set<(version: number) => void>()

  const sub = <F>(set: Set<F>, fn: F) => {
    set.add(fn)
    return () => {
      set.delete(fn)
    }
  }
  const requireBridge = (): Bridge => {
    if (!bridge) throw new Error('The Engine view is not open')
    return bridge
  }

  return {
    attach(next) {
      for (const off of detachListeners) off()
      bridge = next
      ready = null
      describeCache = null
      detachListeners = [
        next.on('ready', (m) => {
          ready = pick<EngineReady>(m, ['version', 'sceneId', 'caps'])
          for (const fn of readies) fn(ready)
        }),
        next.on('selected', (m) => {
          const ids = Array.isArray(m.ids) ? (m.ids as string[]) : []
          for (const fn of selected) fn(ids)
        }),
        next.on('tick', (m) => {
          for (const fn of ticks) fn(Number(m.f), true)
        }),
        next.on('stopped', (m) => {
          for (const fn of ticks) fn(Number(m.f), false)
        }),
        next.on('version', (m) => {
          for (const fn of versions) fn(Number(m.version))
        }),
      ]
    },
    detach(which) {
      if (which && which !== bridge) return
      for (const off of detachListeners) off()
      detachListeners = []
      bridge = null
      ready = null
      describeCache = null
    },
    async hello(sceneUrl) {
      const reply = await requireBridge().request('hello', { sceneUrl })
      return pick<EngineReady>(reply as Envelope, ['version', 'sceneId', 'caps'])
    },
    select(ids) {
      bridge?.send('select', { ids })
    },
    time(seq, f) {
      bridge?.send('time', { seq, f })
    },
    play(seq, from, to, rate) {
      bridge?.send('play', {
        seq,
        from,
        ...(to === undefined ? {} : { to }),
        ...(rate === undefined ? {} : { rate }),
      })
    },
    async stop() {
      const reply = (await requireBridge().request('stop')) as Envelope
      return Number(reply.f)
    },
    async pose() {
      const reply = (await requireBridge().request('pose?')) as Envelope
      return pick<CameraPose>(reply, ['p', 't', 'fov'])
    },
    describe() {
      const b = bridge
      if (!b) return Promise.reject(new Error('The Engine view is not open'))
      if (!describeCache) {
        describeCache = b.request('describe?').then((reply) => {
          const r = reply as Envelope
          return {
            roles: Array.isArray(r.roles) ? (r.roles as RoleInfo[]) : [],
            kinds: Array.isArray(r.kinds) ? (r.kinds as string[]) : [],
          }
        })
        describeCache.catch(() => {
          describeCache = null
        })
      }
      return describeCache
    },
    onSelected: (fn) => sub(selected, fn),
    onTick: (fn) => sub(ticks, fn),
    onReady: (fn) => sub(readies, fn),
    onVersion: (fn) => sub(versions, fn),
    isReady: () => ready !== null,
  }
}

/** The adapter the editor's panels share. One engine is docked at a time. */
export const engineAdapter: AttachableEngineAdapter = createEngineAdapter()
