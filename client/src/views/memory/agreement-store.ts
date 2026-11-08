// 记忆页「约定」那一段的数据（2026-11-03：旧的原话 / 解释三栏去掉后，约定单独成一段）：一页 50 条往后翻，
// 事件流来的新版本就地换（按版本，旧的不往回改），拉的期间到的事件换上快照后再放一遍（snapshot-loader.ts）。
// 约定的确认生效 / 撤 / 采纳提议由本人会话确认，经 SignedSender 发（标识和请求体存在 signed-ops，没了结就地给再核实）。
// 第一次打开约定那一段才拉。

import type { PlasticineApi } from '../../api/client.ts';
import { errorText } from '../../api/errors.ts';
import type { EventsHub } from '../../api/events-hub.ts';
import type {
  AgreementListResponse,
  AgreementView,
  ConfirmAgreementRequest,
  LiveEvent,
} from '../../api/types.ts';
import { agreementOpKey } from '../../state/signed-ops.ts';
import { Store } from '../../state/store.ts';
import type { LoadStatus } from '../../state/load.ts';
import type { SignedSender } from '../signing/signed-sender.ts';
import { SnapshotLoader } from '../../state/snapshot-loader.ts';
import { appendPage, emptyColumn, placeItem, type Column } from './column-pages.ts';

export interface AgreementsData {
  status: LoadStatus;
  error: string | null;
  agreements: Column<AgreementView>;
}

const EMPTY: AgreementsData = { status: 'idle', error: null, agreements: emptyColumn() };

const DECISION_LABELS: Readonly<Record<ConfirmAgreementRequest['decision'], string>> = {
  confirm: '确认这条约定',
  revoke: '撤这条约定',
  adopt: '按提议生效',
  reject: '不采纳提议',
};

export class AgreementStore {
  readonly data = new Store<AgreementsData>(EMPTY);
  private readonly api: PlasticineApi;
  private readonly hub: EventsHub;
  private readonly signer: SignedSender;
  private readonly loader: SnapshotLoader<AgreementListResponse>;
  private readonly versions = new Map<string, number>();
  private pageGeneration = 0;
  private stopListening: (() => void) | null = null;

  constructor(api: PlasticineApi, hub: EventsHub, signer: SignedSender) {
    this.api = api;
    this.hub = hub;
    this.signer = signer;
    this.loader = new SnapshotLoader({
      fetch: () => {
        this.pageGeneration += 1;
        return this.api.agreements.list({});
      },
      apply: (snapshot, replay) => this.applySnapshot(snapshot, replay),
      fail: (message) => this.data.set((data) => ({ ...data, status: 'failed', error: message })),
    });
  }

  start(): void {
    if (this.stopListening !== null) {
      return;
    }
    this.loader.restart();
    this.stopListening = this.hub.on((event) => this.onEvent(event));
  }

  stop(): void {
    this.stopListening?.();
    this.stopListening = null;
    this.loader.stop();
    this.pageGeneration += 1;
    this.data.set((data) => ({ ...data, status: data.status === 'loading' ? 'idle' : data.status,
      agreements: { ...data.agreements, loadingMore: false } }));
  }

  /** 约定那一段打开时调：还没拉过（或上次没拉到）才拉。 */
  ensureLoaded(): void {
    const { status } = this.data.get();
    if (status === 'idle' || status === 'failed') {
      void this.reload();
    }
  }

  reload(): Promise<void> {
    this.data.set((data) => ({ ...data, status: data.status === 'ready' ? 'ready' : 'loading', error: null }));
    return this.loader.load();
  }

  /** 往后翻一页。 */
  async more(): Promise<void> {
    const current = this.data.get().agreements;
    if (current.nextOffset === null || current.loadingMore) {
      return;
    }
    const offset = current.nextOffset;
    const generation = this.pageGeneration;
    this.data.set((data) => ({ ...data, agreements: { ...data.agreements, loadingMore: true, error: null } }));
    try {
      const page = await this.api.agreements.list({ offset });
      if (generation !== this.pageGeneration) {
        return;
      }
      const rows = page.agreements.filter((row) => this.newer(row.id, row.version, true));
      this.data.set((data) => ({ ...data, agreements: appendPage(data.agreements, rows, page.nextOffset) }));
    } catch (cause) {
      if (generation !== this.pageGeneration) {
        return;
      }
      const error = errorText(cause);
      this.data.set((data) => ({ ...data, agreements: { ...data.agreements, loadingMore: false, error } }));
    }
  }

  /** 一条约定的新版本（写操作的回答、事件流）。force：版本相同也换（翻页拿到的同版本行）。 */
  applyAgreement(agreement: AgreementView, force = false): void {
    if (!this.newer(agreement.id, agreement.version, force)) {
      return;
    }
    this.data.set((data) => ({ ...data, agreements: placeItem(data.agreements, agreement, true) }));
  }

  /** 确认生效 / 撤 / 采纳或不采纳提议：由本人会话确认。 */
  async decide(agreement: AgreementView, decision: ConfirmAgreementRequest['decision']): Promise<void> {
    await this.signer.send(
      agreementOpKey(agreement.id),
      DECISION_LABELS[decision],
      agreement.title ?? agreement.text,
      { kind: 'agreement_confirm', agreementId: agreement.id },
      (requestId) => ({ requestId, version: agreement.version, decision }),
    );
  }

  private newer(id: string, version: number, force: boolean): boolean {
    const known = this.versions.get(id);
    if (known !== undefined && (force ? known > version : known >= version)) {
      return false;
    }
    this.versions.set(id, version);
    return true;
  }

  private onEvent(event: LiveEvent): void {
    this.loader.note(event);
    if (this.data.get().status === 'idle') {
      return;
    }
    switch (event.type) {
      case 'agreement.changed':
        this.applyAgreement(event.agreement);
        return;
      case 'resync':
        void this.reload();
        return;
      default:
        return;
    }
  }

  private applySnapshot(snapshot: AgreementListResponse, replay: readonly LiveEvent[]): void {
    for (const row of snapshot.agreements) {
      this.versions.set(row.id, row.version);
    }
    this.data.set({ status: 'ready', error: null,
      agreements: { ...emptyColumn(), items: snapshot.agreements, nextOffset: snapshot.nextOffset } });
    for (const event of replay) {
      if (event.type === 'agreement.changed') {
        this.applyAgreement(event.agreement);
      }
    }
  }
}
