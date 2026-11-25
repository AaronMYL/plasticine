// SPDX-License-Identifier: Apache-2.0

import { Type, type Static } from 'typebox';
import { API_PREFIX, IdSchema, IsoTimeSchema } from './common.ts';
import { OrNull } from './lineage.ts';

export const MAIL_IMAGE_PATH = `${API_PREFIX}/mail-image`;

export const ContactMailSchema = Type.Object({
  subject: Type.String(),
  fromName: OrNull(Type.String()),
  fromAddress: Type.String(),
  html: Type.Boolean(),
  attachments: Type.Array(Type.String()),
});
export type ContactMail = Static<typeof ContactMailSchema>;

export const MailBodyResponseSchema = Type.Object({
  id: IdSchema,
  subject: Type.String(),
  fromName: OrNull(Type.String()),
  fromAddress: Type.String(),
  toAddress: OrNull(Type.String()),
  at: IsoTimeSchema,
  html: OrNull(Type.String()),
  text: Type.String(),
  attachments: Type.Array(Type.String()),
});
export type MailBodyResponse = Static<typeof MailBodyResponseSchema>;

export const MailImageQuerySchema = Type.Object({
  u: Type.String({ minLength: 1, maxLength: 3_000 }),
  e: Type.String({ pattern: '^[0-9]{1,13}$' }),
  s: Type.String({ pattern: '^[A-Za-z0-9_-]{43}$' }),
});
export type MailImageQuery = Static<typeof MailImageQuerySchema>;
