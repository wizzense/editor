import type { AnyNodeDefinition, NodeDefinition } from '@pascal-app/core'
import { SEQUENCE_SCHEMA_VERSION, SeqCameraNode, SequenceNode } from './schema'

export const sequenceDefinition: NodeDefinition<typeof SequenceNode> = {
  kind: 'seq:sequence',
  schemaVersion: SEQUENCE_SCHEMA_VERSION,
  schema: SequenceNode,
  category: 'utility',
  dirtyTracking: false,
  defaults: () => ({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    kind: 'film',
    fps: 24,
    range: [1, 241],
    sections: [],
    tracks: [],
  }),
  // Time, not space: nothing to draw, select or move in the 3D view. The Timeline view edits it.
  capabilities: { duplicable: false, deletable: false, presettable: false },
  presentation: {
    label: 'Sequence',
    description: 'A timeline over the scene: sections and keyed tracks on one frame clock.',
    icon: { kind: 'iconify', name: 'lucide:film' },
    paletteSection: 'structure',
    hidden: true,
  },
  mcp: {
    description:
      'A sequence: fps, range [f0, f1], named sections and tracks {target, channel, keys [{f, v, e}]}. Key it with seq.key / seq.unkey ops.',
  },
}

export const seqCameraDefinition: NodeDefinition<typeof SeqCameraNode> = {
  kind: 'seq:camera',
  schemaVersion: SEQUENCE_SCHEMA_VERSION,
  schema: SeqCameraNode,
  category: 'utility',
  dirtyTracking: false,
  defaults: () => ({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    position: [0, 10, 10],
    target: [0, 0, 0],
    fov: 45,
  }),
  // Keyed on the timeline ("Key camera here"), so it is shown and selectable but not dragged.
  capabilities: {
    selectable: { hitVolume: 'bbox' },
    duplicable: false,
    deletable: false,
    presettable: false,
  },
  renderer: { kind: 'parametric', module: () => import('./camera-renderer') },
  presentation: {
    label: 'Sequence camera',
    description: 'A camera a sequence keys: position, target and field of view.',
    icon: { kind: 'iconify', name: 'lucide:video' },
    paletteSection: 'structure',
    hidden: true,
  },
  mcp: { description: 'A camera for sequences: position, target, fov (degrees).' },
}

export const sequenceNodeDefinitions = [
  sequenceDefinition,
  seqCameraDefinition,
] as unknown as AnyNodeDefinition[]
