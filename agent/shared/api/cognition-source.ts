import { Type, type Static } from 'typebox';
import { EvidenceSchema } from '../state.ts';
import { ChangeRecordViewSchema, OrNull, SourceViewSchema } from './lineage.ts';

export const CognitionSourceDetailSchema = Type.Object({
  source: OrNull(SourceViewSchema),
  evidence: OrNull(EvidenceSchema),
  history: Type.Array(ChangeRecordViewSchema),
});
export type CognitionSourceDetail = Static<typeof CognitionSourceDetailSchema>;
