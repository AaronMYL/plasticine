import { MAIN_LINE_ALIAS } from '../api/shared.ts';
import type { ActionOps } from './action-ops.ts';
import { AttachmentDrafts } from './attachment-drafts.ts';
import { ConversationUi } from './conversation-ui.ts';

export interface LineComposerState { ui: ConversationUi; attachments: AttachmentDrafts }

/** 页内对话与悬浮框按线共用草稿；目标变化只换引用，不搬动内容。 */
export class ConversationRegistry {
  private readonly entries = new Map<string, LineComposerState>();
  private readonly ops: ActionOps;
  constructor(ui: ConversationUi, attachments: AttachmentDrafts, ops: ActionOps) {
    this.entries.set(MAIN_LINE_ALIAS, { ui, attachments });
    this.ops = ops;
  }
  forLine(lineId: string): LineComposerState {
    let entry = this.entries.get(lineId);
    if (entry === undefined) {
      entry = { ui: new ConversationUi(null), attachments: new AttachmentDrafts(null, this.ops) };
      this.entries.set(lineId, entry);
    }
    return entry;
  }
}
