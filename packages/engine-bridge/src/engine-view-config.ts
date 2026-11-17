export type EngineViewConfig = {
  /** The engine page's base URL, e.g. `http://127.0.0.1:8899`. */
  engineUrl: string
  /** The scene id the host serves. */
  sceneId: string
  /** The scene host document URL, sent in `hello`. */
  sceneUrl: string
  /**
   * The engine page path and query, with `{scene}` and `{parent}` filled in
   * (`{parent}` = this editor's origin, URL-encoded).
   */
  pathTemplate: string
}

let config: EngineViewConfig | null = null

export function configureEngineView(next: EngineViewConfig): void {
  config = next
}

export function engineViewConfig(): EngineViewConfig | null {
  return config
}

export function engineViewSrc(c: EngineViewConfig, parentOrigin: string): string {
  const path = c.pathTemplate
    .replaceAll('{scene}', encodeURIComponent(c.sceneId))
    .replaceAll('{parent}', encodeURIComponent(parentOrigin))
  return `${c.engineUrl.replace(/\/$/, '')}${path.startsWith('/') ? '' : '/'}${path}`
}
