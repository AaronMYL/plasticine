// SPDX-License-Identifier: Apache-2.0

import { Type, type Static } from 'typebox';

export const WelcomeStartSchema = Type.Object({
  id: Type.String({ minLength: 1, maxLength: 40 }),
  label: Type.String({ minLength: 1, maxLength: 20 }),
  icon: Type.String({ minLength: 1, maxLength: 30 }),
  prompt: Type.String({ minLength: 1, maxLength: 500 }),
}, { additionalProperties: false });
export type WelcomeStart = Static<typeof WelcomeStartSchema>;
