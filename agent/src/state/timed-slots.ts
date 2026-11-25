import {
  HeartbeatBeatInputSchema,
  HeartbeatBeatSchema,
  TimedSlotInputSchema,
  TimedSlotPatchSchema,
  TimedSlotSchema,
  type HeartbeatBeat,
  type HeartbeatBeatInput,
  type TimedSlot,
  type TimedSlotPatch,
  type TimedSlotSource,
} from '../../shared/state.ts';
import { Type } from 'typebox';
import { RECORD_META_COLUMNS, type ColumnMap } from './codec.ts';
import { ObjectStore, type StoreContext, type StoreSpec } from './object-store.ts';

const SLOT_COLUMNS: ColumnMap = {
  ...RECORD_META_COLUMNS,
  source: 'text',
  nextAt: 'text',
  lastRunAt: 'text',
  lastOutcome: 'text',
  lastNote: 'text',
  lineId: 'text',
  enabled: 'boolean',
  removedAt: 'text',
  config: 'json',
  memo: 'json',
};

const SLOT_SPEC: StoreSpec<typeof TimedSlotSchema, typeof TimedSlotInputSchema, typeof TimedSlotPatchSchema> = {
  table: 'timed_slots',
  schema: TimedSlotSchema,
  input: TimedSlotInputSchema,
  patch: TimedSlotPatchSchema,
  columns: SLOT_COLUMNS,
  defaults: { nextAt: null, lastRunAt: null, lastOutcome: null, lastNote: null, lineId: null, enabled: true,
    removedAt: null, config: {}, memo: {} },
};

const BEAT_COLUMNS: ColumnMap = {
  ...RECORD_META_COLUMNS,
  at: 'text',
  found: 'json',
  did: 'json',
  note: 'text',
  failed: 'boolean',
};

const NoPatch = Type.Object({}, { additionalProperties: false });

const BEAT_SPEC: StoreSpec<typeof HeartbeatBeatSchema, typeof HeartbeatBeatInputSchema, typeof NoPatch> = {
  table: 'heartbeat_beats',
  schema: HeartbeatBeatSchema,
  input: HeartbeatBeatInputSchema,
  patch: NoPatch,
  columns: BEAT_COLUMNS,
  defaults: {},
};

export function createTimedSlotStore(context: StoreContext) {
  const slots = new ObjectStore(context, SLOT_SPEC);
  const beats = new ObjectStore(context, BEAT_SPEC);
  return {
    get: (id: string): TimedSlot | undefined => slots.get(id),
    require: (id: string): TimedSlot => slots.require(id),
    ensure(id: string, source: TimedSlotSource, config: Record<string, unknown> = {}): TimedSlot {
      return context.db.transaction(() => slots.get(id) ?? slots.create({ source, config }, undefined, { id }));
    },
    update: (id: string, version: number, patch: TimedSlotPatch): TimedSlot => slots.update(id, version, patch),
    heartbeats: {
      add: (input: HeartbeatBeatInput): HeartbeatBeat => beats.create(input),
      recent: (limit: number): HeartbeatBeat[] =>
        beats.select('1 = 1', {}, { limit }, 'at DESC, created_at DESC, id DESC'),
    },
  };
}

