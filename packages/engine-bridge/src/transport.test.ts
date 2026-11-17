import { describe, expect, test } from 'bun:test'
import {
  BRIDGE_PROTO,
  type BridgeClock,
  BridgeTimeoutError,
  createBridge,
  createEngineAdapter,
  type Envelope,
  isEnvelope,
  type MessageSource,
} from './index'

const EDITOR = 'http://editor.test'
const ENGINE = 'http://engine.test'

/** A window pair: posting on one side dispatches a MessageEvent on the other, stamped with the sender's origin. */
function windowPair() {
  const make = (origin: string) => {
    const listeners = new Set<(event: MessageEvent) => void>()
    const win: MessageSource & { origin: string; deliver(data: unknown, from: string): void } = {
      origin,
      addEventListener: (_type, fn) => listeners.add(fn),
      removeEventListener: (_type, fn) => listeners.delete(fn),
      deliver(data, from) {
        for (const fn of [...listeners]) fn({ data, origin: from } as MessageEvent)
      },
    }
    return win
  }
  const editor = make(EDITOR)
  const engine = make(ENGINE)
  const posted: { message: unknown; targetOrigin: string }[] = []
  const toEngine = {
    postMessage(message: unknown, targetOrigin: string) {
      posted.push({ message, targetOrigin })
      engine.deliver(structuredClone(message), EDITOR)
    },
  }
  const toEditor = (message: unknown, from = ENGINE) =>
    editor.deliver(structuredClone(message), from)
  return { editor, engine, toEngine, toEditor, posted }
}

function manualClock() {
  let now = 0
  const timers = new Map<number, { at: number; fn: () => void }>()
  let seq = 0
  const clock: BridgeClock & { advance(ms: number): void } = {
    setTimeout(fn, ms) {
      seq += 1
      timers.set(seq, { at: now + ms, fn })
      return seq
    },
    clearTimeout(handle) {
      timers.delete(handle as number)
    },
    advance(ms) {
      now += ms
      for (const [id, t] of [...timers]) {
        if (t.at <= now) {
          timers.delete(id)
          t.fn()
        }
      }
    },
  }
  return clock
}

/** A fake engine page that answers the bridge the way the contract says. */
function fakeEngine(pair: ReturnType<typeof windowPair>) {
  pair.engine.addEventListener('message', (event) => {
    const m = event.data as Envelope
    if (!isEnvelope(m) || event.origin !== EDITOR) return
    const reply = (type: string, fields: object) =>
      pair.toEditor({ proto: BRIDGE_PROTO, id: null, type, re: m.id ?? undefined, ...fields })
    if (m.type === 'hello') reply('ready', { version: 3, sceneId: 'demo', caps: ['select'] })
    if (m.type === 'pose?') reply('pose', { p: [1, 2, 3], t: [0, 0, 0], fov: 40 })
    if (m.type === 'describe?')
      reply('describe', { roles: [{ id: 'r1', label: 'Red', swatch: '#ff0000' }], kinds: [] })
    if (m.type === 'stop') reply('stopped', { f: 42 })
  })
}

describe('createBridge', () => {
  test('a request resolves with the reply whose re matches its id', async () => {
    const pair = windowPair()
    fakeEngine(pair)
    let n = 0
    const bridge = createBridge({
      target: pair.toEngine,
      targetOrigin: ENGINE,
      allowOrigins: [ENGINE],
      source: pair.editor,
      clock: manualClock(),
      newId: () => `req-${++n}`,
    })
    const reply = await bridge.request<Envelope>('hello', { sceneUrl: 'http://host/x' })
    expect(reply.type).toBe('ready')
    expect(reply.re).toBe('req-1')
    expect(pair.posted[0]).toEqual({
      message: {
        proto: BRIDGE_PROTO,
        id: 'req-1',
        type: 'hello',
        sceneUrl: 'http://host/x',
      },
      targetOrigin: ENGINE,
    })
    bridge.dispose()
  })

  test('messages from an origin outside the allowlist are dropped', async () => {
    const pair = windowPair()
    const clock = manualClock()
    const bridge = createBridge({
      target: { postMessage() {} },
      targetOrigin: ENGINE,
      allowOrigins: [ENGINE],
      source: pair.editor,
      clock,
      newId: () => 'only',
    })
    const seen: string[] = []
    bridge.on('selected', (m) => seen.push(String((m.ids as string[])[0])))
    const pending = bridge.request('pose?')
    // A forged reply from another origin must neither resolve the request nor reach listeners.
    pair.toEditor(
      { proto: BRIDGE_PROTO, id: null, type: 'pose', re: 'only', p: [0, 0, 0] },
      'http://evil.test',
    )
    pair.toEditor(
      { proto: BRIDGE_PROTO, id: null, type: 'selected', ids: ['x'] },
      'http://evil.test',
    )
    pair.toEditor({ proto: BRIDGE_PROTO, id: null, type: 'selected', ids: ['ok'] })
    expect(seen).toEqual(['ok'])
    clock.advance(3000)
    await expect(pending).rejects.toBeInstanceOf(BridgeTimeoutError)
    bridge.dispose()
  })

  test('a request with no reply rejects after its timeout, not before', async () => {
    const pair = windowPair()
    const clock = manualClock()
    const bridge = createBridge({
      target: { postMessage() {} },
      targetOrigin: ENGINE,
      allowOrigins: [ENGINE],
      source: pair.editor,
      clock,
    })
    let settled = false
    const pending = bridge.request('describe', {}, 500).finally(() => {
      settled = true
    })
    clock.advance(499)
    await Promise.resolve()
    expect(settled).toBe(false)
    clock.advance(1)
    await expect(pending).rejects.toBeInstanceOf(BridgeTimeoutError)
    bridge.dispose()
  })

  test('envelopes without the protocol tag are ignored', () => {
    expect(isEnvelope({ type: 'ready', id: null })).toBe(false)
    expect(isEnvelope({ proto: BRIDGE_PROTO, type: 'ready', id: null })).toBe(true)
  })
})

describe('EngineAdapter', () => {
  test('pose, describe and stop go through the bridge; ticks and selection come back', async () => {
    const pair = windowPair()
    fakeEngine(pair)
    const bridge = createBridge({
      target: pair.toEngine,
      targetOrigin: ENGINE,
      allowOrigins: [ENGINE],
      source: pair.editor,
      clock: manualClock(),
    })
    const adapter = createEngineAdapter()
    adapter.attach(bridge)
    expect(await adapter.pose()).toEqual({ p: [1, 2, 3], t: [0, 0, 0], fov: 40 })
    expect((await adapter.describe()).roles[0]?.id).toBe('r1')

    const ticks: [number, boolean][] = []
    adapter.onTick((f, playing) => ticks.push([f, playing]))
    const sel: string[][] = []
    adapter.onSelected((ids) => sel.push(ids))
    pair.toEditor({ proto: BRIDGE_PROTO, id: null, type: 'tick', f: 12 })
    pair.toEditor({ proto: BRIDGE_PROTO, id: null, type: 'selected', ids: ['a'] })
    expect(await adapter.stop()).toBe(42)
    expect(ticks).toEqual([
      [12, true],
      [42, false],
    ])
    expect(sel).toEqual([['a']])

    adapter.play('seq_a', 1, 10)
    const last = pair.posted.at(-1)?.message as Envelope
    expect(last).toMatchObject({ type: 'play', seq: 'seq_a', from: 1, to: 10, id: null })

    adapter.detach(bridge)
    await expect(adapter.pose()).rejects.toThrow('not open')
    bridge.dispose()
  })
})
