export const PRESENCE_TTL_MS = 90_000;

export class Presence {
  readonly #seen = new Map<string, { conversation: string; at: number }>();

  report(deviceId: string, conversation: string | null, now: Date): void {
    if (conversation === null) {
      this.#seen.delete(deviceId);
      return;
    }
    this.#seen.set(deviceId, { conversation, at: now.getTime() });
  }

  viewing(conversation: string, now: Date): boolean {
    for (const [deviceId, seen] of this.#seen) {
      if (now.getTime() - seen.at > PRESENCE_TTL_MS) {
        this.#seen.delete(deviceId);
        continue;
      }
      if (seen.conversation === conversation) return true;
    }
    return false;
  }
}
