// The token estimate every part of context assembly uses (context.ts, memory-context.ts).

// Estimated tokens = UTF-8 bytes / 3: a Chinese character is 3 bytes and about one token, English (about 4 bytes
// per token) is over-counted. Over-counting only cuts history a little early; under-counting would overflow.
export const BYTES_PER_TOKEN = 3;

export function estimateTokens(text: string): number {
  return Math.ceil(Buffer.byteLength(text, 'utf8') / BYTES_PER_TOKEN);
}
