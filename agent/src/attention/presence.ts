// 「正在看哪段对话」（第13批，11-14 Aaron：正在看的对话有新消息时不重复通知）：页面在前台时一分钟左右报一次自己开着
// 哪段对话（line:<线 id> / contact:<联系人或群 id>），切走、收起、页面到后台就报 null。新消息通知发之前看一眼：哪台设备
// 正在看这段，就不通知。只在内存里，重启就清；90 秒没报就当没在看。

/** 多久没报就当没在看（页面一分钟报一次，留半分钟余量）。 */
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

  /** 有没有哪台设备正开着这段对话（页面在前台）。 */
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
