// 一篇笔记的自动保存（照旧版 NoteEditor 的行为重写，不依赖 TipTap，单独可测）：
// - 停笔 1.2 秒保存，带草稿基于的 version；输入法组合中不保存，组合结束再排。
// - 没保存上的字一直在 state/note-drafts 里：切笔记、切视图、卸载都不丢，回来接着存。
// - 409：别处存了新版本，不覆盖，进「冲突」让人选；如果那一版正是自己这次要存的（回执丢了但已落地），当作存上了。
// - 回执不确定：状态「结果待核实」，留着同一个 request_id，下次用它重发（服务端按标识去重）。

import { errorText, isUncertain, NoteConflictError } from '../../api/errors.ts';
import type { NoteView, SaveNoteRequest } from '../../api/types.ts';
import type { NoteDrafts } from '../../state/note-drafts.ts';
import { Store } from '../../state/store.ts';
import { ActionOps } from '../../state/action-ops.ts';

/** 停笔多久自动保存：1.2 秒，和旧版 NoteEditor 一致。 */
export const AUTOSAVE_DELAY_MS = 1200;

export type SaveStatus = 'saved' | 'dirty' | 'saving' | 'uncertain' | 'failed' | 'conflict';

export interface SaverState {
  status: SaveStatus;
  error: string | null;
  /** 冲突时服务端的当前版本。 */
  conflict: NoteView | null;
}

export interface NoteSaverOptions {
  note: NoteView;
  drafts: NoteDrafts;
  save: (id: string, input: SaveNoteRequest) => Promise<NoteView>;
  newRequestId: () => string;
  onSaved?: ((note: NoteView) => void) | undefined;
  delayMs?: number | undefined;
  actionOps?: ActionOps;
}

export class NoteSaver {
  readonly state: Store<SaverState>;
  private readonly options: NoteSaverOptions;
  private readonly id: string;
  private confirmed: NoteView;
  private markdown: string;
  private composing = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** 回执不确定的那次请求：原样留着，重试时用同一个 request_id。 */
  private unresolved: SaveNoteRequest | null = null;
  private running: Promise<void> | null = null;
  private readonly ops: ActionOps;
  private restoreSource: number | undefined;
  private disposed = false;

  constructor(options: NoteSaverOptions) {
    this.options = options;
    this.ops = options.actionOps ?? new ActionOps();
    this.id = options.note.id;
    this.confirmed = options.note;
    const draft = options.drafts.get(this.id);
    if (draft !== undefined && draft.markdown !== options.note.markdown) {
      this.markdown = draft.markdown;
      this.state = new Store<SaverState>({ status: 'dirty', error: null, conflict: null });
      this.schedule();
    } else {
      options.drafts.clear(this.id);
      this.markdown = options.note.markdown;
      this.state = new Store<SaverState>({ status: 'saved', error: null, conflict: null });
    }
    const pending = this.ops.get(`note:${this.id}:save`);
    if (pending !== undefined && pending.status !== 'failed' && pending.request.kind === 'note_save') {
      this.cancelTimer();
      this.unresolved = pending.request.body;
      this.setState({ status: 'uncertain', error: '上次保存的结果待核实，请沿用原请求核实。' });
    }
    options.drafts.savers.add(this);
  }

  readyForRefresh(): boolean { return !this.composing && this.state.get().status === 'saved'; }

  /** 编辑器一开始该显示的正文：有没存上的草稿就是草稿。 */
  initialMarkdown(): string {
    return this.markdown;
  }

  current(): NoteView {
    return this.confirmed;
  }

  /** 先保存当前草稿；只有明确成功且期间没有新输入，才把所选历史另存一版。 */
  async restore(markdown: string, version: number): Promise<boolean> {
    await this.flush();
    if (this.state.get().status !== 'saved' || this.composing || this.confirmed.readOnly) {
      return false;
    }
    if (markdown === this.confirmed.markdown) {
      return true;
    }
    this.edit(markdown);
    this.restoreSource = version;
    await this.flush();
    return this.state.get().status === 'saved';
  }

  edit(markdown: string): void {
    this.restoreSource = undefined;
    this.markdown = markdown;
    const { status } = this.state.get();
    // 改回上次确认的原文只在没有请求在路上时才算「已保存」：在途的那次会把改过的版本写上去，撤销的目标要留成草稿，
    // 等它落地后再存回原文（review-followups adf44c1）。
    const idle = this.running === null && this.unresolved === null;
    if (markdown === this.confirmed.markdown && status !== 'conflict' && idle) {
      this.options.drafts.clear(this.id);
      this.setState({ status: 'saved', error: null });
      this.cancelTimer();
      return;
    }
    const existing = this.options.drafts.get(this.id);
    this.options.drafts.put({
      noteId: this.id,
      baseVersion: existing?.baseVersion ?? this.confirmed.version,
      markdown,
    });
    if (status === 'saved' || status === 'failed') {
      this.setState({ status: 'dirty' });
    }
    this.schedule();
  }

  setComposing(composing: boolean): void {
    this.composing = composing;
    if (composing) {
      this.cancelTimer();
    } else if (this.options.drafts.get(this.id) !== undefined) {
      this.schedule();
    }
  }

  /** 立刻存；正在存就等它存完再看还有没有要存的。 */
  async flush(): Promise<void> {
    this.cancelTimer();
    while (this.running !== null) {
      await this.running;
    }
    if (this.composing || this.state.get().status === 'conflict') {
      return;
    }
    const request = this.unresolved ?? this.nextRequest();
    if (request === null) {
      return;
    }
    this.running = this.send(request);
    try {
      await this.running;
    } finally {
      this.running = null;
      if (this.disposed) { this.options.drafts.savers.delete(this); }
    }
  }

  /** 冲突时选「保留我的」：以服务端当前版本为底，把我的草稿存上去（旧版本留在服务端的版本记录里）。 */
  async keepMine(): Promise<void> {
    const current = this.state.get().conflict;
    if (current === null) {
      return;
    }
    this.confirmed = current;
    this.options.drafts.put({ noteId: this.id, baseVersion: current.version, markdown: this.markdown });
    this.setState({ status: 'dirty', conflict: null, error: null });
    await this.flush();
  }

  /** 冲突时选「用新版本」：丢掉我的草稿，返回要放进编辑器的正文。 */
  takeTheirs(): string {
    const current = this.state.get().conflict ?? this.confirmed;
    this.confirmed = current;
    this.markdown = current.markdown;
    this.unresolved = null;
    this.options.drafts.clear(this.id);
    this.setState({ status: 'saved', conflict: null, error: null });
    return current.markdown;
  }

  /** 对照面板采纳后的正文仍以当前冲突版本保存，写到一半的草稿不会先被丢弃。 */
  async resolveWith(markdown: string): Promise<void> {
    this.edit(markdown);
    await this.keepMine();
  }

  /** 别处存了新版本（事件流来的）：自己没有没存的字时才换，返回是否换了。 */
  applyRemote(note: NoteView): boolean {
    if (note.version <= this.confirmed.version || this.state.get().status !== 'saved') {
      return false;
    }
    this.confirmed = note;
    this.markdown = note.markdown;
    this.setState({ status: 'saved', error: null });
    return true;
  }

  /** 卸载时：还有没存的就马上存一次；草稿留在 state/ 里，存上了才清。 */
  dispose(flush = true): void {
    this.disposed = true;
    this.cancelTimer();
    if (flush && !this.composing && this.options.drafts.get(this.id) !== undefined) {
      void this.flush().finally(() => this.options.drafts.savers.delete(this));
    } else { this.options.drafts.savers.delete(this); }
  }

  private nextRequest(): SaveNoteRequest | null {
    const previous = this.ops.get(`note:${this.id}:save`);
    if (previous !== undefined && previous.status !== 'failed' && previous.request.kind === 'note_save') {
      return previous.request.body;
    }
    const draft = this.options.drafts.get(this.id);
    if (draft === undefined) {
      return null;
    }
    return {
      markdown: draft.markdown,
      version: draft.baseVersion,
      requestId: this.options.newRequestId(),
      ...(this.restoreSource === undefined ? {} : { restoredFromVersion: this.restoreSource }),
    };
  }

  private async send(request: SaveNoteRequest): Promise<void> {
    const key = `note:${this.id}:save`;
    const pending = this.ops.begin(key, '保存笔记', '笔记',
      () => ({ kind: 'note_save', noteId: this.id, body: request }), () => request.requestId);
    if (pending.kind !== 'note_save') {
      throw new Error('笔记操作的类型不匹配');
    }
    this.setState({ status: 'saving', error: null });
    try {
      this.landed(await this.options.save(this.id, pending.body));
    } catch (cause) {
      this.ops.fail(key, cause);
      if (cause instanceof NoteConflictError && cause.current.markdown === request.markdown) {
        // 自己上一次的保存其实已经落地（回执丢了，或在别的编辑器实例里存的）。
        this.landed(cause.current);
      } else if (cause instanceof NoteConflictError) {
        this.unresolved = null;
        this.setState({ status: 'conflict', conflict: cause.current, error: null });
      } else if (isUncertain(cause)) {
        this.unresolved = request;
        this.setState({ status: 'uncertain', error: errorText(cause) });
      } else {
        this.unresolved = null;
        this.setState({ status: 'failed', error: errorText(cause) });
      }
    }
  }

  private landed(saved: NoteView): void {
    this.ops.succeed(`note:${this.id}:save`);
    this.restoreSource = undefined;
    this.unresolved = null;
    if (saved.version < this.confirmed.version) {
      const draft = this.options.drafts.get(this.id);
      if (draft !== undefined && draft.markdown !== this.confirmed.markdown) {
        this.setState({ status: 'conflict', conflict: this.confirmed, error: null });
      } else {
        this.options.drafts.clear(this.id);
        this.setState({ status: 'saved', error: null });
      }
      return;
    }
    this.confirmed = saved;
    const draft = this.options.drafts.get(this.id);
    if (draft === undefined || draft.markdown === saved.markdown) {
      this.options.drafts.clear(this.id);
      this.setState({ status: 'saved', error: null });
    } else {
      // 存的这段时间里又写了字：草稿换到新版本上，接着排下一次。
      this.options.drafts.put({ ...draft, baseVersion: saved.version });
      this.setState({ status: 'dirty', error: null });
      this.schedule();
    }
    this.options.onSaved?.(saved);
  }

  private schedule(): void {
    this.cancelTimer();
    if (this.composing) {
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.options.delayMs ?? AUTOSAVE_DELAY_MS);
  }

  private cancelTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private setState(patch: Partial<SaverState>): void {
    this.state.set((state) => ({ ...state, ...patch }));
  }
}
