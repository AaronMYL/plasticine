// 通知统一成「主线发一条消息 + 系统通知」（《优化清单》第 12 条，他 11-06 定；11-01 定的两类邮件兜底一并取消，不再发
// 任何通知邮件）。一件事：
// - 主线上一条系统来源的消息（lines/ 的 notice，不冒充他说的、也不冒充 Plasticine 说的）；
// - 系统通知：网页推送给每台开了通知的浏览器（Windows 上的网页、加到主屏幕的 iPhone 网页），Mac App 由客户端看到
//   这条消息后自己弹（客户端 push-switch.ts）。推送只带一句话和站内链接，不带正文（第 91 条）。
// 同一件按 key 只发一次：key 记成回执的动作标识（和以前通知信的动作标识一样，寄过信的那件不在主线上补发）；主线没写成
// 时回执跟着回滚，下次扫描再发；推送失败只记日志，主线上那条照样在。

import { NOTICE_TITLE, type PushPayload } from '../../shared/api/push.ts';
import { errorCategory, safeLog } from '../shared-log.ts';
import type { StateService } from '../state/index.ts';

const NOTICE_TOOL = 'main_notice';

export interface NoticeInput {
  /** 这件事的稳定标识（「项目 + 截止日」「磁盘 + 那一天」）。 */
  key: string;
  /** 主线上那条消息的正文（站内看，可以有项目名）。 */
  text: string;
  /** 系统通知里那一句：不带私密内容。 */
  brief: string;
  /** 点系统通知打开哪里：本站路径，以 / 开头。 */
  url: string;
}

/** 发一件通知；返回这次是不是新发的（同一件发过就是 false）。 */
export interface NoticePoster {
  post(input: NoticeInput): boolean;
}

export interface NoticesOptions {
  state: Pick<StateService, 'receipts' | 'transaction'>;
  /** 主线上写一条（lines/ 的 LineKernel.notice）。 */
  post: (input: NoticeInput) => void;
  push: { announce(payload: PushPayload): Promise<unknown> };
  now: () => Date;
}

export class Notices implements NoticePoster {
  readonly #options: NoticesOptions;
  readonly #pending = new Set<Promise<void>>();

  constructor(options: NoticesOptions) {
    this.#options = options;
  }

  post(input: NoticeInput): boolean {
    const { state, now } = this.#options;
    const fresh = state.transaction(() => {
      const issued = state.receipts.issue({ actionId: input.key, tool: NOTICE_TOOL, argsDigest: input.key,
        replay: 'once', effect: 'internal', receivedAt: now().toISOString() });
      if (!issued.created) {
        return false;
      }
      this.#options.post(input);
      state.receipts.update(input.key, issued.receipt.version, { status: 'succeeded',
        executedAt: now().toISOString() });
      return true;
    });
    if (fresh) {
      this.announce({ body: input.brief, url: input.url, tag: input.key });
    }
    return fresh;
  }

  /** 只发系统通知（消息已经在主线上了，比如后台线贴回的结果）。 */
  announce(input: { body: string; url: string; tag: string }): void {
    const work = this.#options.push.announce({ title: NOTICE_TITLE, ...input });
    const pending: Promise<void> = work.then(() => undefined, (error: unknown) => {
      safeLog('error', 'notice_push_failed', { category: errorCategory(error) });
    }).finally(() => {
      this.#pending.delete(pending);
    });
    this.#pending.add(pending);
  }

  /** 已经发出去的推送都结束（测试、关服务）。 */
  async settled(): Promise<void> {
    while (this.#pending.size > 0) {
      await Promise.allSettled([...this.#pending]);
    }
  }
}
