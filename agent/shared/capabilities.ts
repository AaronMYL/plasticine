import { Type, type Static } from 'typebox';

export const CapabilityProbeSchema = Type.Object({
  supported: Type.Boolean(),
  configured: Type.Boolean(),
  connected: Type.Union([Type.Boolean(), Type.Null()]),
  detail: Type.String(),
  data: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
});
export type CapabilityProbe = Static<typeof CapabilityProbeSchema>;
export const CapabilitySchema = Type.Object({
  ...CapabilityProbeSchema.properties,
  id: Type.String(), label: Type.String(), tools: Type.Array(Type.String()), enabled: Type.Boolean(),
  ready: Type.Boolean(), checkedAt: Type.String(),
  status: Type.Enum(['disabled', 'unsupported', 'not_configured', 'disconnected', 'unknown', 'ready']),
});
export type Capability = Static<typeof CapabilitySchema>;
export const CapabilitiesInspectSchema = Type.Object({ id: Type.Optional(Type.String({ maxLength: 100 })) },
  { additionalProperties: false });
