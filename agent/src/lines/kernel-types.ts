import type { ImageContent } from '@earendil-works/pi-ai';
import type { LineInputOrigin, LineMessageView, LineStreamEvent, LineView, QueuedMessageView }
  from '../../shared/api/lines.ts';
import type { ModelPurpose } from '../../shared/api/model-purposes.ts';
import type { AskDesk } from '../attention/index.ts';
import type { LineRow, StateService } from '../state/index.ts';
import type { LineReportMessage } from './messages.ts';
import type { DriveOutcome, RunnerHost } from './runner.ts';
import type { AskToolHost } from './ask-tools.ts';
import type { SubmitHoldPort } from './page-submit-tool.ts';
import type { DirectTools } from './tool-loadout.ts';
import type { KernelTool, Later, ModelSource } from './types.ts';

export const MAX_BACKGROUND_LINES = 3;
export const DEFAULT_TIME_ZONE = 'Asia/Shanghai';

export type KernelState = Pick<StateService, 'lines' | 'linePlans' | 'lineMessages' | 'lineDays' | 'lineQueue'
  | 'lineApprovals' | 'mates' | 'mateGroups' | 'outboundGrants' | 'outboundLog' | 'schedules' | 'contactMessages'
  | 'maintenanceOperations' | 'groupMessages' | 'asks' | 'transaction'
  | 'memoryDocs' | 'memoryJournal' | 'projects' | 'attachments'>
  & Partial<Pick<StateService, 'loop'>>;

export type Compactor = NonNullable<RunnerHost['compact']>;

export interface KernelOptions {
  state: KernelState;
  contextImages?: (lineId: string) => ImageContent[];
  desk: AskDesk;
  models: ModelSource;
  publish(event: LineStreamEvent): void;
  tools?: readonly KernelTool[];
  now?: () => Date;
  later?: Later;
  publicUrl?: () => string;
  maxBackground?: number | (() => number);
  askTools?: readonly ((host: AskToolHost) => KernelTool)[];
  submits?: SubmitHoldPort;
  compact?: Compactor;
  timeZone?: string;
  zone?: () => string;
  directTools?: DirectTools;
  skillsContext?: (lineId: string) => string;
  recall?: (call: { name: string; args: unknown }, resultText: string, shown: Set<string>) => string | null;
  turnEnded?: (line: LineRow, outcome: DriveOutcome) => void;
  reported?: (report: LineReportMessage, parent: LineRow) => void;
}

export interface OpenLine {
  mateId?: string | null;
  mateGroupId?: string | null;
  attachments?: readonly string[];
  title: string;
  goal: string;
  projectId: string | null;
  parentLineId: string | null;
  sealedPrompt?: string;
  origin?: LineInputOrigin;
  resumeParent?: boolean;
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
  replyTo?: number;
  attachments?: readonly string[];
  origin?: LineInputOrigin;
}

export type SendResult =
  | { outcome: 'started'; line: LineView; message: LineMessageView; queued: null }
  | { outcome: 'queued'; line: LineView; message: null; queued: QueuedMessageView };

