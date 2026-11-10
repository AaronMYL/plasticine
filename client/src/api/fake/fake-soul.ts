import { MAIN_SOUL_DEFAULTS } from '../../../../agent/shared/soul.ts';
import type { ChangeSoulRequest, SoulLine, SoulView } from '../shared.ts';
import type { SoulApi } from '../soul-client.ts';
import { ApiError } from '../errors.ts';
import type { FakeSession } from './fake-session.ts';
import type { FakeReceipts } from './receipts.ts';

export class FakeSoul implements SoulApi {
  private value: SoulView;
  private readonly previous = new Map<string, SoulLine>();
  private serial = 0;
  private readonly session: FakeSession;
  private readonly receipts: FakeReceipts;
  private readonly now: () => Date;
  private readonly changed: (view: SoulView) => void;
  constructor(session: FakeSession, receipts: FakeReceipts, now: () => Date, changed: (view: SoulView) => void) {
    this.session = session;
    this.receipts = receipts;
    this.now = now;
    this.changed = changed;
    this.value = { title: '主线的 Soul', history: [], lines: MAIN_SOUL_DEFAULTS.map((item) => ({
      id: `soul-default-${item.key}`, version: 1, text: item.text, section: item.section, source: 'system',
      at: now().toISOString(), sources: [{ kind: 'system', id: `soul-default-${item.key}`,
        label: '系统默认', at: now().toISOString() }],
    })) };
  }

  async get(): Promise<SoulView> {
    this.session.require();
    this.changed(this.value);
    return structuredClone(this.value);
  }

  async change(input: ChangeSoulRequest): Promise<SoulView> {
    this.session.requireUser();
    return this.receipts.run('save', input.requestId, `soul:${JSON.stringify(input)}`, () => {
      const at = this.now().toISOString();
      let id: string;
      let text: string;
      if (input.action === 'add') {
        id = `soul-user-${++this.serial}`;
        text = input.text.trim();
        this.value.lines.push({ id, version: 1, text, section: input.section, source: 'user', at, sources: [] });
      } else {
        const index = this.value.lines.findIndex((line) => line.id === input.id && line.version === input.version);
        const current = this.value.lines[index];
        if (current === undefined) throw new ApiError({ kind: 'conflict', status: 409, code: 'version_conflict',
          message: '这条规则已改过或撤销，请刷新后再试。' });
        id = current.id;
        text = current.text;
        if (input.action === 'undo') {
          const original = this.previous.get(current.id);
          this.value.lines.splice(index, 1, ...(original === undefined ? [] : [{ ...original,
            id: `soul-user-${++this.serial}` }]));
        } else {
          id = `soul-user-${++this.serial}`;
          this.previous.set(id, structuredClone(current));
          text = input.action === 'edit' ? input.text.trim() : current.text;
          this.value.lines[index] = { ...current, id, text, section: input.section,
            source: input.action === 'move' ? current.source : 'user', at, version: 1 };
        }
      }
      this.value.history.unshift({ id: `soul-event-${++this.serial}`, lineId: id,
        action: input.action, text, at, actor: 'user' });
      this.changed(this.value);
      return structuredClone(this.value);
    });
  }
}
