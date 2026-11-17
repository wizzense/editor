import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  diffNodesToOps,
  migrateExtElement,
  RemoteSceneSync,
  type SceneDoc,
  type SceneNode,
  type ScenePort,
} from './index'

const FIXTURES = join(import.meta.dir, '__fixtures__')
const doc = () => JSON.parse(readFileSync(join(FIXTURES, 'scene.min.json'), 'utf8')) as SceneDoc
const sseFrames = () =>
  readFileSync(join(FIXTURES, 'events.sample.txt'), 'utf8')
    .replaceAll(String.fromCharCode(13), '')
    .trim()
    .split('\n\n')
    .map((block) => {
      const [event, data] = block.split('\n')
      return {
        event: (event ?? '').slice('event: '.length),
        data: (data ?? '').slice('data: '.length),
      }
    })

type Nodes = Record<string, SceneNode>

function fakePort(initial: Nodes) {
  let nodes: Nodes = structuredClone(initial)
  let commit: ((before: Nodes, current: Nodes) => void) | null = null
  const applied: { scope: string; ids: string[] }[] = []
  const port: ScenePort = {
    nodes: () => nodes,
    applyNodes(next, scope) {
      applied.push({ scope, ids: Object.keys(next) })
      const out: Nodes = scope === 'all' ? {} : { ...nodes }
      for (const [id, node] of Object.entries(next)) {
        if (node === null) delete out[id]
        else out[id] = structuredClone(node)
      }
      nodes = out
    },
    subscribeLocalCommits(fn) {
      commit = fn
      return () => {
        commit = null
      }
    },
  }
  return {
    port,
    applied,
    get nodes() {
      return nodes
    },
    /** A local edit: the store changes, then the commit fires. */
    edit(mutate: (draft: Nodes) => void) {
      const before = nodes
      const draft = structuredClone(nodes)
      mutate(draft)
      nodes = draft
      commit?.(before, draft)
    },
  }
}

type Call = { url: string; method: string; body: unknown }

function fakeFetch(responses: Record<string, { status: number; body: unknown }[]>) {
  const calls: Call[] = []
  const fetchImpl = async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    const key = `${method} ${url}`
    const queue = responses[key]
    const next = queue && queue.length > 1 ? queue.shift() : queue?.[0]
    if (!next) throw new Error(`unexpected ${key}`)
    return new Response(JSON.stringify(next.body), { status: next.status })
  }
  return { calls, fetchImpl }
}

const HOST = 'http://host.test/api/scene/demo'
const author = { kind: 'human' as const, id: 'pascal:test' }
const settle = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
  await new Promise<void>((resolve) => queueMicrotask(resolve))
}

describe('diffNodesToOps', () => {
  const base = doc().graph.nodes

  test('an element move is a position-only update; derived fields are refused', () => {
    const next = structuredClone(base)
    ;(next.el_g1 as SceneNode).position = [1, 0, -7.9]
    ;(next.el_g68 as SceneNode).color = '#000000'
    const { ops, refused } = diffNodesToOps(base, next)
    expect(ops).toEqual([{ op: 'node.update', id: 'el_g1', patch: { position: [1, 0, -7.9] } }])
    expect(refused).toEqual(['el_g68'])
  })

  test('a drawn wall is created under its level; children and sequences never leave as node ops', () => {
    const next = structuredClone(base)
    const wall: SceneNode = {
      object: 'node',
      id: 'wall_a',
      type: 'wall',
      parentId: 'level_demo_0',
      visible: true,
      children: [],
      start: [10, 20],
      end: [16, 20],
      metadata: {},
    }
    next.wall_a = wall
    ;(next.level_demo_0 as SceneNode).children = ['wall_a']
    ;(next.seq_film as SceneNode).range = [1, 999]
    expect(diffNodesToOps(base, next).ops).toEqual([{ op: 'node.create', node: wall }])

    // ...and undoing it (another commit) deletes it again.
    expect(diffNodesToOps(next, base).ops).toEqual([{ op: 'node.delete', id: 'wall_a' }])
  })
})

describe('RemoteSceneSync', () => {
  test('an SSE ops frame applies its node states, idempotently, and advances the version', async () => {
    const { fetchImpl } = fakeFetch({ [`GET ${HOST}`]: [{ status: 200, body: doc() }] })
    const fake = fakePort({})
    const sync = new RemoteSceneSync({ sceneUrl: HOST, author, port: fake.port, fetch: fetchImpl })
    const graph = await sync.load()
    fake.port.applyNodes(graph.nodes, 'all')
    expect(sync.version).toBe(0)

    const frame = sseFrames().find((f) => f.event === 'ops')
    expect(frame).toBeDefined()
    expect(sync.applyFrameData(frame?.data ?? '')).toBe(true)
    const once = structuredClone(fake.nodes)
    expect(sync.applyFrameData(frame?.data ?? '')).toBe(true)
    expect(fake.nodes).toEqual(once)
    expect((fake.nodes.el_g1 as SceneNode).position).toEqual([0, 0, -12.9])
    expect(Object.keys(fake.nodes).sort()).toEqual(Object.keys(graph.nodes).sort())
    expect(sync.version).toBe(1)
  })

  test('a local move posts one batch on the last seen version', async () => {
    const { calls, fetchImpl } = fakeFetch({
      [`GET ${HOST}`]: [{ status: 200, body: doc() }],
      [`POST ${HOST}/ops`]: [
        {
          status: 200,
          body: {
            ok: true,
            version: 1,
            results: [],
            diff: { changedIds: ['el_g1'], created: [], deleted: [] },
            guard: [],
          },
        },
      ],
    })
    const fake = fakePort(doc().graph.nodes)
    const sync = new RemoteSceneSync({
      sceneUrl: HOST,
      author,
      port: fake.port,
      fetch: fetchImpl,
      eventSource: () => ({ addEventListener() {}, close() {} }),
    })
    await sync.load()
    sync.start()
    fake.edit((d) => {
      ;(d.el_g1 as SceneNode).position = [1, 0, -7.9]
    })
    await settle()
    expect(calls.at(-1)).toEqual({
      url: `${HOST}/ops`,
      method: 'POST',
      body: {
        baseVersion: 0,
        author,
        ops: [{ op: 'node.update', id: 'el_g1', patch: { position: [1, 0, -7.9] } }],
      },
    })
    expect(sync.version).toBe(1)
    sync.stop()
  })

  test('a 409 reloads the whole document and says so', async () => {
    const newer = doc()
    newer.version = 7
    ;(newer.graph.nodes.el_g1 as SceneNode).position = [5, 0, -7.9]
    const { fetchImpl } = fakeFetch({
      [`GET ${HOST}`]: [
        { status: 200, body: doc() },
        { status: 200, body: newer },
      ],
      [`POST ${HOST}/ops`]: [
        { status: 409, body: { ok: false, error: 'version_conflict', version: 7 } },
      ],
    })
    const notes: string[] = []
    const fake = fakePort(doc().graph.nodes)
    const sync = new RemoteSceneSync({
      sceneUrl: HOST,
      author,
      port: fake.port,
      fetch: fetchImpl,
      eventSource: () => ({ addEventListener() {}, close() {} }),
      notify: (m) => notes.push(m),
    })
    await sync.load()
    sync.start()
    fake.edit((d) => {
      ;(d.el_g1 as SceneNode).position = [1, 0, -7.9]
    })
    await settle()
    expect(fake.applied.at(-1)?.scope).toBe('all')
    expect((fake.nodes.el_g1 as SceneNode).position).toEqual([5, 0, -7.9])
    expect(sync.version).toBe(7)
    expect(notes).toEqual(['Someone else changed this; reloaded.'])
    sync.stop()
  })

  test('a 400 reverts the change from the last known state and reports the host error', async () => {
    const { fetchImpl } = fakeFetch({
      [`GET ${HOST}`]: [{ status: 200, body: doc() }],
      [`POST ${HOST}/ops`]: [{ status: 400, body: { ok: false, error: '0: no' } }],
    })
    const notes: string[] = []
    const fake = fakePort(doc().graph.nodes)
    const sync = new RemoteSceneSync({
      sceneUrl: HOST,
      author,
      port: fake.port,
      fetch: fetchImpl,
      eventSource: () => ({ addEventListener() {}, close() {} }),
      notify: (m) => notes.push(m),
    })
    await sync.load()
    sync.start()
    fake.edit((d) => {
      d.wall_b = { id: 'wall_b', type: 'wall', parentId: 'level_demo_0' }
    })
    await settle()
    expect(fake.nodes.wall_b).toBeUndefined()
    expect(notes).toEqual(['The host refused the edit: 0: no'])
    sync.stop()
  })
  test('an edit seen twice (a commit and the undo that carries it) is sent once', async () => {
    const ok = {
      status: 200,
      body: {
        ok: true,
        version: 1,
        results: [],
        diff: { changedIds: [], created: [], deleted: [] },
        guard: [],
      },
    }
    const start = doc()
    start.graph.nodes.wall_c = { id: 'wall_c', type: 'wall', parentId: 'level_demo_0' }
    const { calls, fetchImpl } = fakeFetch({
      [`GET ${HOST}`]: [{ status: 200, body: start }],
      [`POST ${HOST}/ops`]: [ok],
    })
    const fake = fakePort(start.graph.nodes)
    const sync = new RemoteSceneSync({
      sceneUrl: HOST,
      author,
      port: fake.port,
      fetch: fetchImpl,
      eventSource: () => ({ addEventListener() {}, close() {} }),
    })
    await sync.load()
    sync.start()
    const withWall = fake.nodes
    fake.edit((d) => {
      delete d.wall_c
    })
    // The same removal reported again from a state that still had the wall.
    fake.port.applyNodes(withWall, 'all')
    fake.edit((d) => {
      delete d.wall_c
    })
    await settle()
    const posts = calls.filter((c) => c.method === 'POST')
    expect(posts.map((c) => (c.body as { ops: unknown[] }).ops)).toEqual([
      [{ op: 'node.delete', id: 'wall_c' }],
    ])
    sync.stop()
  })
})

describe('ext:element schema', () => {
  test('v1 load path fills defaults and accepts a scalar rotation', () => {
    const node = migrateExtElement({ id: 'el_x', type: 'ext:element', rotation: 0.5 })
    expect(node.rotation).toEqual([0, 0.5, 0])
    expect(node.size).toBeNull()
    expect(node.payload).toEqual({})
  })

  test('every fixture element parses unchanged', () => {
    for (const node of Object.values(doc().graph.nodes)) {
      if (node.type !== 'ext:element') continue
      expect(migrateExtElement(node)).toEqual(node as never)
    }
  })
})
