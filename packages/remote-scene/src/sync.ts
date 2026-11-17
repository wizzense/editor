import { diffNodesToOps } from './diff'
import {
  type EventSourceFactory,
  type EventSourceLike,
  type FetchLike,
  parseOpsFrame,
  SceneHostClient,
} from './host-client'
import type { Author, OpsResponse, SaveResponse, SceneDoc, SceneNode, SceneOp } from './ops'

/** What the sync needs from the editor's scene store (the default port binds the real store). */
export type ScenePort = {
  nodes(): Record<string, SceneNode>
  /** Bring nodes to the host state outside undo; `all` also deletes local nodes not listed. */
  applyNodes(nodes: Record<string, SceneNode | null>, scope: 'all' | 'listed'): void
  /** Local commits only (the person's edits, undo, redo), never the ones `applyNodes` made. */
  subscribeLocalCommits(
    fn: (before: Record<string, SceneNode>, current: Record<string, SceneNode>) => void,
  ): () => void
  isDerived?(node: SceneNode): boolean
}

export type Notify = (message: string, level: 'info' | 'error') => void

export type RemoteSceneSyncOptions = {
  sceneUrl: string
  author: Author
  port: ScenePort
  fetch?: FetchLike
  eventSource?: EventSourceFactory
  notify?: Notify
  /** Plugin ids the editor must treat as installed for the host's kinds to show. */
  plugins?: string[]
}

export type SyncStatus = { version: number; connected: boolean; lastError: string | null }

/**
 * Keeps the editor and a scene host in step. The host is the one writer: every local commit leaves as an op
 * batch on the version the editor last saw, and every batch the host accepts (from anyone) comes back on its
 * event stream with the post-batch node states, which the editor applies outside its own undo history.
 */
export class RemoteSceneSync {
  readonly client: SceneHostClient
  private readonly options: RemoteSceneSyncOptions
  private readonly notify: Notify
  private source: EventSourceLike | null = null
  private unsubscribe: (() => void) | null = null
  private queue: Promise<unknown> = Promise.resolve()
  private listeners = new Set<(status: SyncStatus) => void>()
  private status: SyncStatus = { version: 0, connected: false, lastError: null }
  doc: SceneDoc | null = null

  constructor(options: RemoteSceneSyncOptions) {
    this.options = options
    this.client = new SceneHostClient(options.sceneUrl, options.fetch)
    this.notify =
      options.notify ??
      ((m, level) => (level === 'error' ? console.error : console.info)(`[remote-scene] ${m}`))
  }

  get version(): number {
    return this.status.version
  }

  get author(): Author {
    return this.options.author
  }

  onStatus(fn: (status: SyncStatus) => void): () => void {
    this.listeners.add(fn)
    fn(this.status)
    return () => {
      this.listeners.delete(fn)
    }
  }

  private setStatus(patch: Partial<SyncStatus>) {
    this.status = { ...this.status, ...patch }
    for (const fn of this.listeners) fn(this.status)
  }

  /** GET the document. Returns the graph to load, with the host's kinds' plugins marked installed. */
  async load(): Promise<SceneDoc['graph']> {
    const doc = await this.client.getDoc()
    this.doc = doc
    this.setStatus({ version: doc.version })
    const installed = new Set([
      ...(doc.graph.installedPlugins ?? []),
      ...(this.options.plugins ?? []),
    ])
    return { ...doc.graph, installedPlugins: [...installed] }
  }

  /** Follow the host's events and send local commits. Call after the graph is in the editor. */
  start(): void {
    if (this.unsubscribe) return
    this.unsubscribe = this.options.port.subscribeLocalCommits((before, current) =>
      this.onLocalCommit(before, current),
    )
    const factory =
      this.options.eventSource ??
      ((url: string) =>
        new (
          globalThis as unknown as { EventSource: new (u: string) => EventSourceLike }
        ).EventSource(url))
    const source = factory(this.client.eventsUrl())
    this.source = source
    source.addEventListener('hello', (event) => {
      this.setStatus({ connected: true })
      try {
        const { version } = JSON.parse(event.data) as { version: number }
        // Reconnected after missing batches: take the host's state again.
        if (typeof version === 'number' && version !== this.status.version && this.doc) {
          void this.reload()
        }
      } catch {
        // a hello without data is still a connection
      }
    })
    source.addEventListener('ops', (event) => this.applyFrameData(event.data))
    source.addEventListener('error', () => this.setStatus({ connected: false }))
  }

  stop(): void {
    this.unsubscribe?.()
    this.unsubscribe = null
    this.source?.close()
    this.source = null
  }

  /** Apply one `ops` event's data. Idempotent: a frame already reflected locally changes nothing. */
  applyFrameData(data: string): boolean {
    const frame = parseOpsFrame(data)
    if (!frame) return false
    this.options.port.applyNodes(frame.nodes, 'listed')
    if (frame.version > this.status.version) this.setStatus({ version: frame.version })
    return true
  }

  /** Take the host's whole state again (after a conflict or a missed stretch of events). */
  async reload(): Promise<void> {
    const doc = await this.client.getDoc()
    this.doc = doc
    this.options.port.applyNodes(doc.graph.nodes, 'all')
    this.setStatus({ version: doc.version })
  }

  private onLocalCommit(before: Record<string, SceneNode>, current: Record<string, SceneNode>) {
    const { ops, refused } = diffNodesToOps(before, current, {
      isDerived: this.options.port.isDerived,
    })
    if (refused.length > 0) {
      // Host-owned fields change only through the host: put them back as they were.
      this.options.port.applyNodes(
        Object.fromEntries(refused.map((id) => [id, before[id] ?? null])),
        'listed',
      )
    }
    if (ops.length === 0) return
    const touched = new Set<string>()
    for (const op of ops) touched.add('id' in op ? op.id : op.node.id)
    void this.enqueue(async () => {
      const { status, body } = await this.client.postOps(
        this.status.version,
        this.options.author,
        ops,
      )
      if (status === 200 && body.ok) {
        this.acceptVersion(body.version)
        return body
      }
      if (status === 409) {
        await this.reload()
        this.notify('Someone else changed this; reloaded.', 'error')
        return body
      }
      // Rejected (all or nothing): undo the local change from the last known state.
      this.options.port.applyNodes(
        Object.fromEntries([...touched].map((id) => [id, before[id] ?? null])),
        'listed',
      )
      const error = 'error' in body ? body.error : `HTTP ${status}`
      this.setStatus({ lastError: error })
      this.notify(`The host refused the edit: ${error}`, 'error')
      return body
    })
  }

  /**
   * Send ops that are not node diffs (a role change, a key on a sequence). On a version conflict the
   * document is reloaded and the batch retried once.
   */
  postOps(ops: SceneOp[]): Promise<OpsResponse> {
    return this.enqueue(async () => {
      let attempt = await this.client.postOps(this.status.version, this.options.author, ops)
      if (attempt.status === 409) {
        await this.reload()
        attempt = await this.client.postOps(this.status.version, this.options.author, ops)
      }
      if (attempt.body.ok) this.acceptVersion(attempt.body.version)
      else {
        this.setStatus({ lastError: attempt.body.error })
        this.notify(`The host refused: ${attempt.body.error}`, 'error')
      }
      return attempt.body
    })
  }

  save(): Promise<SaveResponse> {
    return this.enqueue(() => this.client.save())
  }

  private acceptVersion(version: number) {
    if (version > this.status.version) this.setStatus({ version, lastError: null })
    else this.setStatus({ lastError: null })
  }

  private enqueue<T>(run: () => Promise<T>): Promise<T> {
    const next = this.queue.then(run, run)
    this.queue = next.catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      this.setStatus({ lastError: message })
      this.notify(message, 'error')
    })
    return next
  }
}
