import { Type } from 'typebox';

export const PreferredTimeZoneSchema = Type.Optional(Type.Union([
  Type.String({ minLength: 1, maxLength: 64 }), Type.Null(),
]));

export function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value }).format(0);
    return true;
  } catch (cause) {
    if (cause instanceof RangeError) {
      return false;
    }
    throw cause;
  }
}
