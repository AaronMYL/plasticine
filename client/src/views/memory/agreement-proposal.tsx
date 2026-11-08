import type { ReactNode } from 'react';
import { proposedAgreementText } from '../../api/shared.ts';
import type { AgreementView, ConfirmAgreementRequest } from '../../api/types.ts';

export function AgreementProposal(props: {
  agreement: AgreementView; disabled: boolean; decide: (choice: ConfirmAgreementRequest['decision']) => void;
}): ReactNode {
  const { agreement, disabled, decide } = props;
  if (agreement.proposedDiff === null) {
    return null;
  }
  const next = proposedAgreementText(agreement.text, agreement.proposedDiff);
  return <div className="mem-proposal" aria-label="提议确认">
    <span className="tag tag-outline-quiet">Plasticine 提议</span>
    <dl className="mem-diff">
      <dt>改前</dt><dd className="mem-diff-removed"><del>{agreement.text}</del></dd>
      <dt>改后</dt><dd className="mem-diff-line">{next ?? agreement.proposedDiff}</dd>
    </dl>
    {next === null ? <p className="text-meta">提议与原文对不上，请先核对或改正文。</p> : null}
    <div className="mem-actions">
      <button type="button" className="primary-button" disabled={disabled || next === null}
        onClick={() => decide('adopt')}>按提议生效</button>
      <button type="button" className="text-button" disabled={disabled}
        onClick={() => decide('confirm')}>按原文生效</button>
      <button type="button" className="text-button" disabled={disabled}
        onClick={() => decide('reject')}>不采纳</button>
    </div>
  </div>;
}
