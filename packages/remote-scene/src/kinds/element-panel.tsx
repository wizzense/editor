'use client'

import type { AnyNode } from '@pascal-app/core'
import { useScene } from '@pascal-app/core'
import {
  ActionButton,
  ActionGroup,
  PanelSection,
  PanelWrapper,
  triggerSFX,
  useEditor,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Move } from 'lucide-react'
import ElementInspector from './element-inspector'
import type { ExtElementNode } from './ext-element-schema'

/** The inspector card for a host-owned element: what it is, its role, and the standard Move. */
export default function ExtElementPanel() {
  const selectedId = useViewer((s) => s.selection.selectedIds[0])
  const setSelection = useViewer((s) => s.setSelection)
  const setMovingNode = useEditor((s) => s.setMovingNode)
  const node = useScene((s) =>
    selectedId ? (s.nodes[selectedId as AnyNode['id']] as ExtElementNode | undefined) : undefined,
  )
  if (!node || node.type !== 'ext:element') return null

  return (
    <PanelWrapper
      onClose={() => setSelection({ selectedIds: [] })}
      title={node.name || node.kind || 'Element'}
      width={300}
    >
      <PanelSection title="Host element">
        <ElementInspector node={node} />
      </PanelSection>
      <PanelSection title="Actions">
        <ActionGroup>
          <ActionButton
            icon={<Move className="h-4 w-4" />}
            label="Move"
            onClick={() => {
              triggerSFX('sfx:item-pick')
              setMovingNode(node as never)
              setSelection({ selectedIds: [] })
            }}
          />
        </ActionGroup>
      </PanelSection>
    </PanelWrapper>
  )
}
