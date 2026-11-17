import type { Plugin } from '@pascal-app/core'
import { sequenceNodeDefinitions } from './definitions'

export { seqCameraDefinition, sequenceDefinition } from './definitions'
export {
  findTrack,
  frameToX,
  KEY_EPSILON,
  key,
  keyOp,
  type Ruler,
  rulerStep,
  type TrackRef,
  trackIdFor,
  unkey,
  unkeyOp,
  xToFrame,
} from './ops'
export {
  Ease,
  migrateSeqCamera,
  migrateSequence,
  SEQUENCE_SCHEMA_VERSION,
  SeqCameraNode,
  SeqKey,
  SeqSection,
  SeqTrack,
  SequenceNode,
} from './schema'

export const SEQUENCE_PLUGIN_ID = 'pascal:sequence'

/** The sequence and sequence-camera node kinds. */
export const sequencePlugin: Plugin = {
  id: SEQUENCE_PLUGIN_ID,
  apiVersion: 1,
  nodes: sequenceNodeDefinitions,
}

/** The Timeline host view: register it with `registerEditorHostView(timelineHostView)`. */
export const timelineHostView = {
  id: 'timeline',
  label: 'Timeline',
  icon: { kind: 'iconify', name: 'lucide:gantt-chart' },
  component: () => import('./timeline-view'),
  description: 'Sections, keyed tracks, scrub and play for the scene’s sequence.',
  defaultPinned: true,
} as const
