/** The scene host wire: op batches in, versioned results and an SSE op stream out. */

export type SceneNode = { id: string; type: string; parentId?: string | null } & Record<
  string,
  unknown
>

export type Author = { kind: 'human' | 'agent'; id: string }

export type NodeOp =
  | { op: 'node.create'; node: SceneNode }
  | { op: 'node.update'; id: string; patch: Record<string, unknown> }
  | { op: 'node.delete'; id: string }

export type SceneOp = NodeOp | ({ op: string } & Record<string, unknown>)

export type OpsRequest = { baseVersion: number; author: Author; ops: SceneOp[]; dryRun?: boolean }

export type OpResult = { ok: boolean; changed: string[]; summary: string; warnings: string[] }

export type OpsDiff = { changedIds: string[]; created: string[]; deleted: string[] }

export type OpsOk = {
  ok: true
  version: number
  results: OpResult[]
  diff: OpsDiff
  guard: unknown[]
}
export type OpsConflict = { ok: false; error: 'version_conflict'; version: number }
export type OpsRejected = { ok: false; error: string }
export type OpsResponse = OpsOk | OpsConflict | OpsRejected

export type OpsFrame = {
  version: number
  author: Author
  ops: SceneOp[]
  diff: OpsDiff
  /** Post-batch state of every touched id; null = deleted. */
  nodes: Record<string, SceneNode | null>
}

export type SceneDoc = {
  schema: string
  version: number
  graphHash?: string
  source?: Record<string, unknown>
  world?: Record<string, unknown>
  graph: {
    nodes: Record<string, SceneNode>
    rootNodeIds: string[]
    collections?: Record<string, unknown>
    materials?: Record<string, unknown>
    installedPlugins?: string[]
  }
}

export type SaveResponse = { ok: boolean; wrote?: string[]; error?: string }
