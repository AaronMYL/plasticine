// 记忆页「约定」那一段里的一条：标题、正文、种类和状态、你当时的原话（引用片）、它提议的改动（diff 不用红绿：删去的 --fg2 加删除线，
// 新增的 --fg；左侧 1px --fg3 细线 +「它提议」小签）。本人确认生效 / 撤，等待服务端回执期间避免重复操作。
// 迁移来源留在版本来路里，不作为正文旁的当前状态；是否待答以服务端的实际问题为准。
// 「确认生效」是要你回答的，常显；种类、状态、生效时间常显；在对话里提 / 来路 / 改 / 撤是次要操作，收进行尾 ⋯
// （2026-11-04 第 2 批悬停规则，取代 2026-11-01 的桌面悬停、手机点标题展开）。

import { useState, type ReactNode } from 'react';
import type { AgreementView, ConfirmAgreementRequest } from '../../api/types.ts';
import { CognitionEditor, startCognitionEdit } from './cognition-editor.tsx';
import { AgreementProposal } from './agreement-proposal.tsx';
import { useLive } from '../../live.tsx';
import { OpLines } from '../../primitives/task-row/op-line.tsx';
import { useClientState } from '../../state/context.tsx';
import { agreementOpKey } from '../../state/signed-ops.ts';
import { useStore } from '../../state/use-store.ts';
import { RevealMore, type RevealAction } from '../../shell/reveal-more.tsx';
import { when } from '../notes/note-time.ts';
import { useSignedOps } from '../signing/use-signed-ops.ts';
import { AGREEMENT_KIND_TEXT, AGREEMENT_STATE_TEXT, AWAITING_TEXT } from './labels.ts';
import { AgreementHistory } from './agreement-history.tsx';
import { useMention } from '../conversation/mention-button.tsx';

export function AgreementRow({ agreement }: { agreement: AgreementView }): ReactNode {
  const { agreements, signer } = useLive();
  const { editDrafts } = useClientState();
  const mention = useMention();
  const ops = useSignedOps(agreementOpKey(agreement.id));
  const [confirmingRevoke, setConfirmingRevoke] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const editKey = `cognition:agreement_edit:${agreement.id}`;
  const editing = useStore(editDrafts.store).get(editKey) !== undefined;
  const pending = ops.some((op) => op.status !== 'failed');
  const canConfirm = agreement.awaitingConfirmation || agreement.state === 'under_review'
    || agreement.proposedTerm != null;
  const canRevoke = agreement.state !== 'revoked';
  const fields = [{ name: 'text', label: '正文', value: agreement.text, multiline: true },
    { name: 'scope', label: '适用范围', value: agreement.scope }] as const;
  const decide = (decision: ConfirmAgreementRequest['decision']): void => {
    setConfirmingRevoke(false);
    void agreements.decide(agreement, decision);
  };
  const more: RevealAction[] = [
    { icon: 'quote', label: '在对话里提', onSelect: () => mention({ type: 'agreement', id: agreement.id,
      version: agreement.version, label: agreement.title ?? '这条约定', text: agreement.text }) },
    { icon: 'history', label: historyOpen ? '收起来路' : '上下文与版本来路', onSelect: () => setHistoryOpen(!historyOpen) },
    { icon: 'edit', label: '修改', title: '修改约定', disabled: pending || editing,
      onSelect: () => startCognitionEdit(editDrafts, editKey, agreement.version, fields) },
  ];
  if (canRevoke && !confirmingRevoke) {
    more.push({ icon: 'trash', label: '撤回', disabled: pending, onSelect: () => setConfirmingRevoke(true) });
  }
  const confirmButton = canConfirm && agreement.proposedDiff === null && !confirmingRevoke ? (
    <button type="button" className="chip-button" disabled={pending} onClick={() => decide('confirm')}>
      确认生效
    </button>
  ) : null;
  return (
    <li className="mem-entry" aria-label={agreement.title ?? agreement.text}>
      {agreement.title === null ? null : <p className="mem-title">{agreement.title}</p>}
      <p className={agreement.state === 'revoked' ? 'mem-text is-stale' : 'mem-text'}>{agreement.text}</p>
      <div className="mem-tags">
        <span className="tag tag-neutral">{AGREEMENT_KIND_TEXT[agreement.kind]}</span>
        <span className="tag tag-neutral">{AGREEMENT_STATE_TEXT[agreement.state]}</span>
        {agreement.awaitingConfirmation ? <span className="tag tag-outline">{AWAITING_TEXT}</span> : null}
        {agreement.perUseConfirmation ? <span className="tag tag-neutral">每次都问</span> : null}
        <span className="mem-more"><RevealMore label={`「${agreement.title ?? agreement.text}」的更多操作`}
          actions={more} /></span>
      </div>
      <p className="mem-meta text-meta">
        {agreement.scope}
        {agreement.effectiveAt === null ? '' : ` · ${when(agreement.effectiveAt, new Date())} 起生效`}
      </p>
      {agreement.userQuote === null ? null : <q className="mem-quote">{agreement.userQuote}</q>}
      {historyOpen ? <AgreementHistory id={agreement.id} version={agreement.version} /> : null}
      <AgreementProposal agreement={agreement} disabled={pending} decide={decide} />
      {confirmButton === null ? null : <div className="mem-actions">{confirmButton}</div>}
      <CognitionEditor opKey={editKey} label="改约定" version={agreement.version} inMenu fields={fields}
        agreementId={agreement.id} />
      <OpLines ops={ops} onRetry={(key) => void signer.retry(key)} onDismiss={(key) => signer.dismiss(key)} />
      {confirmingRevoke ? (
        <div className="mem-confirm" role="group" aria-label="确认撤掉">
          <span>撤掉这条约定？撤了它就不再按这条办。</span>
          <button type="button" className="chip-button" onClick={() => decide('revoke')}>
            撤回
          </button>
          <button type="button" className="text-button text-button-quiet" onClick={() => setConfirmingRevoke(false)}>
            先不
          </button>
        </div>
      ) : null}
    </li>
  );
}
