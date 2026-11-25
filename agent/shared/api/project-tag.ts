import { Type, type Static } from 'typebox';
import { IdSchema } from './common.ts';

export const PROJECT_HUES = ['ochre', 'teal', 'sky', 'rose', 'olive', 'slate', 'plum', 'indigo'] as const;
export type ProjectHue = (typeof PROJECT_HUES)[number];

export const ProjectTagSchema = Type.Object({
  id: IdSchema,
  name: Type.String({ minLength: 1 }),
  hue: Type.Enum(PROJECT_HUES),
});
export type ProjectTag = Static<typeof ProjectTagSchema>;
