import type { ImageContent } from '@earendil-works/pi-ai';
// 新内核门面用到的类型和常量：装配选项、拒绝的错误、发消息的结果。

import type { LineInputOrigin, LineMessageView, LineStreamEvent, LineView, QueuedMessageView }
  from '../../shared/api/lines.ts';
import type { ModelPurpose } from '../../shared/api/model-purposes.ts';
import type { AskDesk } from '../attention/index.ts';
import type { StateService } from '../state/index.ts';
import type { LineRow } from '../state/index.ts';
import type { LineReportMessage } from './messages.ts';
import type { DriveOutcome, RunnerHost } from './runner.ts';
import type { AskToolHost } from './ask-tools.ts';
import type { SubmitHoldPort } from './page-submit-tool.ts';
import type { KernelTool, Later, ModelSource } from './types.ts';

/** 同时在跑的后台线上限（他 11-05 定）：多出的排队，有线跑完就接上。 */
export const MAX_BACKGROUND_LINES = 3;
export const DEFAULT_TIME_ZONE = 'Asia/Shanghai';

export type KernelState = Pick<StateService, 'lines' | 'lineMessages' | 'lineDays' | 'lineQueue' | 'lineApprovals'
  | 'mates' | 'mateGroups' | 'outboundGrants' | 'outboundLog' | 'schedules' | 'contactMessages' | 'groupMessages'
  | 'asks' | 'transaction' | 'memoryDocs' | 'memoryJournal' | 'projects' | 'attachments'>;

export type Compactor = NonNullable<RunnerHost['compact']>;

export interface KernelOptions {
  state: KernelState;
  /** 封闭聊天线的图片只读入口，按线身份解析，不写入全局附件或消息。 */
  contextImages?: (lineId: string) => ImageContent[];
  desk: AskDesk;
  models: ModelSource;
  publish(event: LineStreamEvent): void;
  /** 第三级：留下来的业务工具（笔记、记忆、设备……）。线的工具和 ask_user 内核自己带。 */
  tools?: readonly KernelTool[];
  now?: () => Date;
  later?: Later;
  /** Plasticine 写给他的网页地址（app/public-url.ts，按需取：入网、改地址后不用重启）。 */
  publicUrl?: () => string;
  /** 后台线同时跑几条：给数就是固定的，给函数就每次排队时现算（设置里可调、自动按机器算）。 */
  maxBackground?: number | (() => number);
  /**
   * 要出卡、等他答的业务工具（起草定时卡）：内核把自己等卡的那一套交给它们，答了照 ask_user 一样接着跑。
   */
  askTools?: readonly ((host: AskToolHost) => KernelTool)[];
  /** 第三级：提交前问他（page_submit_ask）要设备那边被拦下的提交；不给就没有这件工具。 */
  submits?: SubmitHoldPort;
  /** 第四级：上下文太长时压缩。 */
  compact?: Compactor;
  timeZone?: string;
  /** 他现在的时区（设置里能改）；主线和旁聊按它分天。不给用 timeZone。 */
  zone?: () => string;
  /** 已加载方法每次请求重新装入；作用域与 skill_read 的 line:<id> 一致。 */
  skillsContext?: (lineId: string) => string;
  /**
   * 一轮停下以后（写完库、贴回发起的线之后）告诉外面：主线做完一轮排记忆整理、跨用户任务的线做完发交付。
   * 出错只记日志，不影响线。
   */
  turnEnded?: (line: LineRow, outcome: DriveOutcome) => void;
  /**
   * 后台线的结果要贴回发起它的线时（做完、没做完、额度用完）告诉外面：贴回主线的那些还要发一条系统通知
   * （《优化清单》第 12 条）。只看不改；出错由外面自己记日志。
   */
  reported?: (report: LineReportMessage, parent: LineRow) => void;
}

/** 开一条后台线：开它的线（主对话、跨用户任务没有发起的线是 null）、属于哪个项目、标题和要做什么。 */
export interface OpenLine {
  mateId?: string | null;
  mateGroupId?: string | null;
  attachments?: readonly string[];
  title: string;
  goal: string;
  projectId: string | null;
  parentLineId: string | null;
  /**
   * 封起来的线（替别人答问题，network/responder.ts）：系统提示只用这一段（不带记忆、项目、做事规矩），不给任何工具。
   * 别人能看到的只有它最后那段话，所以它够不着这段以外的东西。
   */
  sealedPrompt?: string;
  origin?: LineInputOrigin;
  /** 需要父线综合结果时显式开启；普通后台结果只贴回一次。 */
  resumeParent?: boolean;
  /** 这条线用哪个用途的模型（研究周报 researcher、回顾 review、心跳 heartbeat、做梦 dream）；不给是 agent。 */
  purpose?: ModelPurpose;
}

export type LineErrorCode = 'not_found' | 'conflict' | 'invalid';

export class LineError extends Error {
  readonly code: LineErrorCode;
  readonly next: string | undefined;

  constructor(code: LineErrorCode, message: string, next?: string) {
    super(message);
    this.name = 'LineError';
    this.code = code;
    this.next = next;
  }
}

export type After = (action: () => void) => void;
export const NOW: After = (action) => action();

export interface SendInput {
  text: string;
  /** 针对这条线里的第几条回复（「回复 Plasticine：……」）。 */
  replyTo?: number;
  attachments?: readonly string[];
  origin?: LineInputOrigin;
}

export type SendResult =
  | { outcome: 'started'; line: LineView; message: LineMessageView; queued: null }
  | { outcome: 'queued'; line: LineView; message: null; queued: QueuedMessageView };

