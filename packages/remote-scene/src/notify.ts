/** A small toast the sync and panels use; the editor has no shared toast surface to plug into. */
export function toast(message: string, level: 'info' | 'error' = 'info'): void {
  if (typeof document === 'undefined') return
  const el = document.createElement('div')
  el.setAttribute('role', level === 'error' ? 'alert' : 'status')
  el.textContent = message
  Object.assign(el.style, {
    position: 'fixed',
    left: '50%',
    bottom: '24px',
    transform: 'translateX(-50%)',
    zIndex: '2147483000',
    maxWidth: '480px',
    padding: '8px 14px',
    borderRadius: '8px',
    font: '12px/1.4 system-ui, sans-serif',
    color: '#fff',
    background: level === 'error' ? 'rgba(185, 28, 28, 0.95)' : 'rgba(24, 24, 27, 0.95)',
    boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
    pointerEvents: 'none',
  } satisfies Partial<CSSStyleDeclaration>)
  document.body.appendChild(el)
  setTimeout(() => el.remove(), 4000)
}
