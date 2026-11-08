import type { ReactNode } from 'react';
import { useLive } from '../../live.tsx';
import { InlineEdit, type InlineEditField } from '../../primitives/inline-edit/index.tsx';
import { OpLines } from '../../primitives/task-row/op-line.tsx';
import { useClientState } from '../../state/context.tsx';
import type { EditDrafts } from '../../state/edit-drafts.ts';
import { useStore } from '../../state/use-store.ts';
import { IconButton } from '../../shell/icon-button.tsx';
import type { IconName } from '../../shell/icons.tsx';

interface Props {
  opKey: string;
  label: string;
  button?: string;
  buttonIcon?: IconName;
  /** 阅读态下和「改」并排的动作；编辑态仍保留在表单下方。 */
  actions?: ReactNode;
  /**
   * 阅读态不画「改」那排：开关在这一条的行尾 ⋯ 里（2026-11-04 第 2 批：次要操作收进行尾 ⋯），由调用方用
   * startCognitionEdit 开始编辑；编辑态照常。
   */
  inMenu?: boolean;
  version: number;
  fields: readonly InlineEditField[];
  /** 约定保存由本人会话确认（POST /v2/agreements/:id/edit）；已生效的保存后按新内容生效。 */
  agreementId: string;
}

/** 开始编辑：把字段现在的值放进共享的编辑草稿（收起条目也不丢）。 */
export function startCognitionEdit(drafts: EditDrafts, opKey: string, version: number,
  fields: readonly InlineEditField[]): void {
  drafts.set(opKey, version, Object.fromEntries(fields.map((field) => [field.name, field.value])));
}

export function CognitionEditor(props: Props): ReactNode {
  const { cognitionActions: actions, signer } = useLive();
  const { editDrafts: drafts, signedOps } = useClientState();
  const draft = useStore(drafts.store).get(props.opKey);
  const ops = useStore(signedOps.store).filter((op) => op.key === props.opKey);
  const conflict = useStore(actions.conflicts).get(props.opKey);
  const pending = ops.some((op) => op.status !== 'failed');
  const retry = (key: string): void => void signer.retry(key);
  const dismiss = (key: string): void => signer.dismiss(key);
  const status = <OpLines ops={ops} onRetry={retry} onDismiss={dismiss} />;
  if (draft === undefined) {
    if (props.inMenu === true) {
      return status;
    }
    const start = (): void => startCognitionEdit(drafts, props.opKey, props.version, props.fields);
    const icon = props.buttonIcon ?? (props.button === undefined ? 'edit' : undefined);
    return <>{status}<div className="mem-actions">
      {icon === undefined ? <button type="button" className="text-button" disabled={pending} onClick={start}>
        {props.button ?? '修改'}
      </button> : <IconButton icon={icon} label={props.button ?? '修改'} title={props.label}
        disabled={pending} onClick={start} />}
      {props.actions}
    </div></>;
  }
  const fields = props.fields.map((field) => ({ ...field, value: draft.fields[field.name] ?? '' }));
  const emptyText = draft.fields['text'] !== undefined && draft.fields['text'].trim() === '';
  const save = (): void => {
    void signer.send(props.opKey, '保存', props.label,
      { kind: 'agreement_edit', agreementId: props.agreementId },
      (requestId) => ({ requestId, version: draft.baseVersion,
        text: draft.fields['text'] ?? '', scope: draft.fields['scope'] ?? '' }));
  };
  const cancel = (): void => {
    drafts.clear(props.opKey);
    actions.clearConflict(props.opKey);
  };
  let statusValue: 'conflict' | 'saving' | 'failed' | 'draft' = 'draft';
  if (conflict !== undefined) {
    statusValue = 'conflict';
  } else if (pending) {
    statusValue = 'saving';
  } else if (ops.length > 0) {
    statusValue = 'failed';
  }
  const editor = <InlineEdit label={props.label} fields={fields}
    status={statusValue}
    onChange={(name, value) => drafts.set(props.opKey, draft.baseVersion, { [name]: value })}
    onSubmit={save} onCancel={cancel}
    submitDisabled={pending || conflict !== undefined || emptyText}
    banner={conflict === undefined ? null : <div className="banner" role="alert">
      <span className="dot dot-accent" aria-hidden="true" />
      <span className="banner-text">现在的第 {conflict.version} 版：{conflict.text}。你的草稿还在。</span>
      <button type="button" className="text-button" onClick={cancel}>用新版本</button>
      <button type="button" className="text-button" onClick={() => {
        drafts.rebase(props.opKey, conflict.version);
        actions.clearConflict(props.opKey);
        dismiss(props.opKey);
      }}>保留我的</button>
    </div>}>
    {status}
  </InlineEdit>;
  return <>{editor}{props.actions ? <div className="mem-actions">{props.actions}</div> : null}</>;
}
