export function createRequestId(): string {
  return `req_${crypto.randomUUID()}`;
}
