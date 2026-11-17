import { type Envelope, isEnvelope, makeEnvelope } from './protocol'

/** What the transport needs from the window it posts to. */
export type PostTarget = { postMessage(message: unknown, targetOrigin: string): void }

/** What the transport needs from the window it listens on. */
export type MessageSource = {
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void
  removeEventListener(type: 'message', listener: (event: MessageEvent) => void): void
}

export type BridgeClock = {
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

export type BridgeOptions = {
  /** The engine page's window (an iframe's `contentWindow`). */
  target: PostTarget
  /** The origin messages are posted to. */
  targetOrigin: string
  /** Origins whose messages are accepted; everything else is dropped. */
  allowOrigins: readonly string[]
  /** Where replies arrive. Default: `window`. */
  source?: MessageSource
  /** Default: the global timers. Tests inject one. */
  clock?: BridgeClock
  /** Default: `crypto.randomUUID`. */
  newId?: () => string
}

export type BridgeListener = (message: Envelope) => void

export type Bridge = {
  send(type: string, fields?: object): void
  request<R = Envelope>(type: string, fields?: object, timeoutMs?: number): Promise<R>
  on(type: string, listener: BridgeListener): () => void
  /** Swap the window posted to (an iframe reload gives a new `contentWindow`). */
  retarget(target: PostTarget): void
  dispose(): void
}

export class BridgeTimeoutError extends Error {
  constructor(type: string, timeoutMs: number) {
    super(`engine bridge: no reply to "${type}" within ${timeoutMs} ms`)
    this.name = 'BridgeTimeoutError'
  }
}

const globalClock: BridgeClock = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
}

export function createBridge(options: BridgeOptions): Bridge {
  const source = options.source ?? (globalThis as unknown as { window: MessageSource }).window
  const clock = options.clock ?? globalClock
  const newId = options.newId ?? (() => globalThis.crypto.randomUUID())
  const allow = new Set(options.allowOrigins)
  let target = options.target
  let disposed = false
  const listeners = new Map<string, Set<BridgeListener>>()
  const pending = new Map<
    string,
    { resolve: (m: Envelope) => void; reject: (e: Error) => void; timer: unknown }
  >()

  const onMessage = (event: MessageEvent) => {
    if (disposed || !allow.has(event.origin)) return
    const message = event.data
    if (!isEnvelope(message)) return
    if (message.re !== undefined) {
      const waiting = pending.get(message.re)
      if (waiting) {
        pending.delete(message.re)
        clock.clearTimeout(waiting.timer)
        waiting.resolve(message)
      }
    }
    for (const listener of listeners.get(message.type) ?? []) listener(message)
  }
  source.addEventListener('message', onMessage)

  return {
    send(type, fields = {}) {
      if (disposed) return
      target.postMessage(makeEnvelope(type, fields, null), options.targetOrigin)
    },
    request<R = Envelope>(type: string, fields: object = {}, timeoutMs = 3000): Promise<R> {
      if (disposed) return Promise.reject(new Error('engine bridge: disposed'))
      const id = newId()
      return new Promise<R>((resolve, reject) => {
        const timer = clock.setTimeout(() => {
          pending.delete(id)
          reject(new BridgeTimeoutError(type, timeoutMs))
        }, timeoutMs)
        pending.set(id, { resolve: resolve as (m: Envelope) => void, reject, timer })
        target.postMessage(makeEnvelope(type, fields, id), options.targetOrigin)
      })
    },
    on(type, listener) {
      let set = listeners.get(type)
      if (!set) {
        set = new Set()
        listeners.set(type, set)
      }
      set.add(listener)
      return () => {
        set?.delete(listener)
      }
    },
    retarget(next) {
      target = next
    },
    dispose() {
      if (disposed) return
      disposed = true
      source.removeEventListener('message', onMessage)
      for (const [, waiting] of pending) {
        clock.clearTimeout(waiting.timer)
        waiting.reject(new Error('engine bridge: disposed'))
      }
      pending.clear()
      listeners.clear()
    },
  }
}
