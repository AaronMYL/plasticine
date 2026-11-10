import { useState, type ReactNode } from 'react';
import type { OutboundGrantInput } from '../../api/shared.ts';
import { Icon } from '../../shell/icons.tsx';
import { InfoTip } from '../../shell/info-tip.tsx';
import { actorLabel, bindingKey, categoryLabel, channelLabel, MAIN_ACTOR, recipientLabel, SCOPE_LABELS }
  from './outbound-format.ts';
import type { OutboundChoices } from './use-outbound-choices.ts';
import './outbound.css';

type Field = 'actor' | 'account' | 'recipients' | 'content';
interface Props {
  value: OutboundGrantInput;
  onChange(value: OutboundGrantInput): void;
  choices: OutboundChoices;
  disabled?: boolean;
  lockActor?: boolean;
}

export function GrantFields({ value, onChange, choices, disabled = false, lockActor = false }: Props): ReactNode {
  const [editing, setEditing] = useState<Field | null>(null);
  const [recipientDraft, setRecipientDraft] = useState(value.recipients.join('\n'));
  const [expiry, setExpiry] = useState(value.expiresAt !== null);
  const patch = (next: Partial<OutboundGrantInput>): void => onChange({ ...value, ...next });
  const actors = choices.actors.some((actor) => actor.id === value.actor) ? choices.actors
    : [...choices.actors, { id: value.actor, label: actorLabel(value.actor) }];
  const taskAvailable = choices.bindings.length > 0;
  const networkRecipients = value.channel === 'cyberhunter.contact' || value.channel === 'cyberhunter.group';
  const row = (field: Field, label: string, shown: ReactNode, children: ReactNode): ReactNode => (
    <div className="grant-field" key={field}>
      <span className="grant-field-label">{label}</span>
      <div className="grant-field-body">
        <button type="button" className="grant-field-trigger" disabled={disabled || field === 'actor' && lockActor}
          aria-label={`修改${label}`} aria-expanded={editing === field}
          onClick={() => {
            if (field === 'recipients') setRecipientDraft(value.recipients.join('\n'));
            setEditing(editing === field ? null : field);
          }}>
          <span>{shown}</span>{field === 'actor' && lockActor ? null : <Icon name="chevron-down" size={14} />}
        </button>
        {editing !== field ? null : <div className="grant-field-editor">{children}</div>}
      </div>
    </div>
  );
  return <div className="grant-fields">
    {row('actor', '谁来发', <span className="grant-actor"><span className="grant-avatar" aria-hidden="true">
      {value.actor === MAIN_ACTOR ? 'P' : actorLabel(value.actor, actors).slice(0, 1)}</span>
      {actorLabel(value.actor, actors)}</span>, <label>发送者<select className="field-input" aria-label="发送者"
        value={value.actor} disabled={disabled} onChange={(event) => patch({ actor: event.target.value })}>
        {actors.map((actor) => <option key={actor.id} value={actor.id}>{actor.label}</option>)}
      </select></label>)}
    {row('account', '平台账号', `${channelLabel(value.channel)} · ${value.account}`,
      <><label>渠道<input className="field-input" aria-label="渠道" value={value.channel} disabled={disabled}
        onChange={(event) => patch({ channel: event.target.value })} /></label>
        <label>账号<input className="field-input" aria-label="账号" value={value.account} disabled={disabled}
          onChange={(event) => patch({ account: event.target.value })} /></label></>)}
    {row('recipients', '发给谁', recipientLabel(value, choices.people), <>
      <label className="grant-check"><input type="checkbox" checked={value.recipientMode === 'all'} disabled={disabled}
        onChange={(event) => patch({ recipientMode: event.target.checked ? 'all' : 'list' })} />这个渠道的所有对象</label>
      {value.recipientMode === 'all' ? null : <>
        {networkRecipients ? <div className="grant-recipient-list" aria-label="发送名单">
          {value.recipients.map((id) => <span className="grant-recipient" key={id}>
            {choices.people.get(id) ?? id}<button type="button" className="text-button" disabled={disabled}
              aria-label={`移出名单：${choices.people.get(id) ?? id}`}
              onClick={() => patch({ recipients: value.recipients.filter((recipient) => recipient !== id) })}>
              <Icon name="close" size={12} /></button></span>)}
        </div> : <label>发送名单<textarea className="field-input" aria-label="发送名单" rows={3} disabled={disabled}
          value={recipientDraft} onChange={(event) => {
            setRecipientDraft(event.target.value);
            patch({ recipients: [...new Set(event.target.value.split('\n').filter(Boolean))] });
          }} /></label>}
        {choices.people.size === 0 ? null : <label>添加联系人<select className="field-input" aria-label="添加联系人"
          value="" disabled={disabled} onChange={(event) => {
            if (event.target.value !== '') {
              const recipients = [...new Set([...value.recipients, event.target.value])];
              setRecipientDraft(recipients.join('\n')); patch({ recipients });
            }
          }}><option value="">选择联系人</option>{[...choices.people].map(([id, name]) =>
            <option key={id} value={id}>{name}</option>)}</select></label>}
      </>}
    </>)}
    {row('content', '发什么', <>{categoryLabel(value.category)}
      {value.fixedTexts === null ? '' : ` · ${value.fixedTexts.length === 1 ? value.fixedTexts[0] : '指定文案'}`}</>, <>
      <label>内容类别<input className="field-input" aria-label="内容类别" value={value.category} disabled={disabled}
        onChange={(event) => patch({ category: event.target.value })} /></label>
      <label className="grant-check"><input type="checkbox" checked={value.fixedTexts !== null} disabled={disabled}
        onChange={(event) => patch({ fixedTexts: event.target.checked ? [''] : null })} />只允许固定文案</label>
      {value.fixedTexts?.map((text, index) => <label key={index}>固定文案{value.fixedTexts!.length > 1 ? index + 1 : ''}
        <textarea className="field-input" aria-label={`固定文案 ${index + 1}`} rows={3} value={text} disabled={disabled}
          onChange={(event) => patch({ fixedTexts: value.fixedTexts!.map((item, n) =>
            n === index ? event.target.value : item) })} /></label>)}
    </>)}
    <div className="grant-field grant-duration"><span className="grant-field-label">多久</span>
      <div className="grant-field-body"><div className="grant-duration-control">
        <div className="segmented" role="group" aria-label="授权多久">
          {(['once', 'task', 'always'] as const).map((kind) => <button key={kind} type="button"
            className="segmented-item" aria-pressed={value.scope.kind === kind}
            disabled={disabled || kind === 'task' && !taskAvailable}
            onClick={() => patch({ scope: kind === 'task' ? { kind, binding: { kind: 'line', id: '' } } : { kind } })}>
            {SCOPE_LABELS[kind]}</button>)}
        </div>
        <InfoTip label="授权有效期说明" text={taskAvailable
          ? '这件事期间只对选定的任务、定时任务或项目生效。一直允许可在设置的授权里随时撤销。'
          : '当前没有可绑定的具体任务或项目，暂时不能选择这件事期间。常驻主线不能代替临时任务。'} />
      </div>
        {value.scope.kind !== 'task' ? null : <label className="grant-binding">绑定任务或项目
          <select className="field-input" aria-label="绑定任务或项目" disabled={disabled}
            value={bindingKey(value.scope.binding)} onChange={(event) => {
              const choice = choices.bindings.find((item) => bindingKey(item) === event.target.value);
              if (choice !== undefined) {
                patch({ scope: { kind: 'task', binding: { id: choice.id, kind: choice.kind } } });
              }
            }}><option value="line:">选择任务或项目</option>
            {choices.bindings.map((binding) => <option key={bindingKey(binding)} value={bindingKey(binding)}>
              {binding.kind === 'project' ? '项目' : binding.kind === 'schedule' ? '定时' : '任务'} · {binding.label}
            </option>)}
          </select></label>}
        <button className="text-button text-button-quiet grant-expiry-toggle" type="button" disabled={disabled}
          onClick={() => { setExpiry(!expiry); if (expiry) patch({ expiresAt: null }); }}>
          {expiry ? '取消到期时间' : '设置到期时间'}</button>
        {expiry ? <label className="grant-binding">到期时间<input className="field-input" type="datetime-local"
          aria-label="到期时间" disabled={disabled}
          value={value.expiresAt === null ? '' : toLocalDateTime(value.expiresAt)} onChange={(event) => {
            const at = new Date(event.target.value);
            patch({ expiresAt: Number.isNaN(at.getTime()) ? null : at.toISOString() });
          }} /></label> : null}
      </div>
    </div>
  </div>;
}

function toLocalDateTime(value: string): string {
  const at = new Date(value);
  return new Date(at.getTime() - at.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}
