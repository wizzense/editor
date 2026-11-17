import type {
  Author,
  OpsFrame,
  OpsRequest,
  OpsResponse,
  SaveResponse,
  SceneDoc,
  SceneOp,
} from './ops'

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export type EventSourceLike = {
  addEventListener(type: string, listener: (event: MessageEvent<string>) => void): void
  close(): void
}

export type EventSourceFactory = (url: string) => EventSourceLike

/** HTTP for one scene on a scene host: `GET <sceneUrl>`, `POST /ops`, `POST /save`, `GET /events`. */
export class SceneHostClient {
  readonly sceneUrl: string
  private readonly fetchImpl: FetchLike

  constructor(sceneUrl: string, fetchImpl?: FetchLike) {
    this.sceneUrl = sceneUrl.replace(/\/$/, '')
    this.fetchImpl = fetchImpl ?? ((input, init) => globalThis.fetch(input, init))
  }

  /** The scene id: the last path segment of the scene URL. */
  get sceneId(): string {
    return decodeURIComponent(
      new URL(this.sceneUrl).pathname.split('/').filter(Boolean).at(-1) ?? '',
    )
  }

  async getDoc(): Promise<SceneDoc> {
    const response = await this.fetchImpl(this.sceneUrl, {
      headers: { accept: 'application/json' },
    })
    if (!response.ok) throw new Error(`scene host: GET ${response.status}`)
    return (await response.json()) as SceneDoc
  }

  async postOps(
    baseVersion: number,
    author: Author,
    ops: SceneOp[],
    dryRun = false,
  ): Promise<{ status: number; body: OpsResponse }> {
    const request: OpsRequest = { baseVersion, author, ops, ...(dryRun ? { dryRun } : {}) }
    const response = await this.fetchImpl(`${this.sceneUrl}/ops`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
    })
    const body = (await response.json().catch(() => ({
      ok: false,
      error: `HTTP ${response.status}`,
    }))) as OpsResponse
    return { status: response.status, body }
  }

  async save(): Promise<SaveResponse> {
    const response = await this.fetchImpl(`${this.sceneUrl}/save`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    return (await response.json().catch(() => ({
      ok: false,
      error: `HTTP ${response.status}`,
    }))) as SaveResponse
  }

  eventsUrl(): string {
    return `${this.sceneUrl}/events`
  }
}

/** Parse one SSE `ops` frame's data. Returns null for anything that is not a frame. */
export function parseOpsFrame(data: string): OpsFrame | null {
  try {
    const frame = JSON.parse(data) as OpsFrame
    if (typeof frame?.version !== 'number' || !frame.nodes || typeof frame.nodes !== 'object')
      return null
    return frame
  } catch {
    return null
  }
}
