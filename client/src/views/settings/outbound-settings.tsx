import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useApi } from '../../api/context.tsx';
import { errorText, isUncertain } from '../../api/errors.ts';
import { createRequestId } from '../../api/request-id.ts';
import type { OutboundGrant, OutboundGrantInput, OutboundLog } from '../../api/shared.ts';
import { useLive } from '../../live.tsx';
import { IconButton } from '../../shell/icon-button.tsx';
import { RevealMore } from '../../shell/reveal-more.tsx';
import { GrantFields } from '../outbound/grant-fields.tsx';
import { actorLabel, categoryLabel, channelLabel, grantEnded, grantInput, LOG_LABELS, MAIN_ACTOR,
  recipientLabel, scopeLabel, validGrant } from '../outbound/outbound-format.ts';
import { useOutboundChoices } from '../outbound/use-outbound-choices.ts';
import { useSettingsDraft } from './settings-dialog-context.ts';
import { SectionHead } from './section-head.tsx';
import { PageLoading } from '../../primitives/page-loading/index.tsx';

interface Edit { row: OutboundGrant; draft: OutboundGrantInput }

export function OutboundSettings(): ReactNode {
  const api = useApi();
  const live = useLive();
  const choices = useOutboundChoices();
  const [grants, setGrants] = useState<OutboundGrant[]>([]);
  const [logs, setLogs] = useState<OutboundLog[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [edit, setEdit] = useState<Edit | null>(null);
  const [revoke, setRevoke] = useState<string | null>(null);
  const [opened, setOpened] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const request = useRef<{ key: string; id: string } | null>(null);
  useSettingsDraft(edit !== null && JSON.stringify(edit.draft) !== JSON.stringify(grantInput(edit.row)),
    () => setEdit(null));
  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([api.outbound.grants(controller.signal), api.outbound.logs(controller.signal)])
      .then(([nextGrants, nextLogs]) => {
        if (!controller.signal.aborted) { setGrants(nextGrants); setLogs(nextLogs); setLoaded(true); setError(null); }
      }, (cause: unknown) => {
        if (!controller.signal.aborted) { setError(errorText(cause)); setLoaded(true); }
      });
    return () => controller.abort();
  }, [api, revision]);
  useEffect(() => live.hub.on((event) => {
    if (event.type === 'resync' || event.type === 'ask.answered'
      || event.type === 'line' && event.event.type === 'line_tool' && event.event.phase === 'ended') {
      setRevision((value) => value + 1);
    }
  }), [live]);

  const write = async (key: string, send: (id: string) => Promise<OutboundGrant>): Promise<void> => {
    if (busy) { return; }
    if (request.current?.key !== key) { request.current = { key, id: createRequestId() }; }
    setBusy(true); setError(null);
    try {
      const row = await send(request.current.id);
      setGrants((values) => values.map((current) => current.id === row.id ? row : current));
      setEdit(null); setRevoke(null); request.current = null;
    } catch (cause) {
      setError(errorText(cause));
      if (!isUncertain(cause)) { request.current = null; }
    } finally { setBusy(false); }
  };
  const change = (row: OutboundGrant, enabled: boolean): void => {
    void write(`toggle:${row.id}:${row.version}:${enabled}`, (requestId) =>
      api.outbound.edit(row.id, { requestId, version: row.version, patch: { enabled } }));
  };
  return <div className="outbound-settings">
    <section className="block" aria-label="对外授权">
      <SectionHead title="对外授权"><IconButton icon="refresh" label="再读一次授权" disabled={busy}
        onClick={() => setRevision((value) => value + 1)} /></SectionHead>
      {!loaded ? <PageLoading rows={3} dense /> : null}
      {loaded && grants.length === 0 && error === null ? <p className="block-empty">还没有对外授权</p> : null}
      <div className="outbound-grants">
        {grants.map((row) => {
          const ended = grantEnded(row);
          const who = actorLabel(row.actor, choices.actors);
          const title = `${channelLabel(row.channel)} · ${categoryLabel(row.category)} → `
            + recipientLabel(row, choices.people);
          return <div className="outbound-grant" key={row.id}>
            <div className="outbound-grant-row" data-ended={ended}>
              <span className="grant-avatar" aria-hidden="true">
                {row.actor === MAIN_ACTOR ? 'P' : who.slice(0, 1)}</span>
              <div className="outbound-grant-copy"><span className="outbound-grant-title">{title}</span>
                <span className="outbound-grant-meta">{who} · {scopeLabel(row.scope)}
                  {row.usedCount > 0 ? ` · 用过 ${row.usedCount} 次` : ''}
                  {row.lastUsedAt === null ? '' : ` · ${shortAt(row.lastUsedAt)}`}</span></div>
              {ended ? <span className="outbound-ended">{row.revokedAt === null ? '已失效' : '已撤销'}</span>
                : <input type="checkbox" role="switch" aria-label={`启用授权：${title}`} checked={row.enabled}
                  disabled={busy} onChange={(event) => change(row, event.target.checked)} />}
              <RevealMore label={`授权操作：${title}`} actions={row.revokedAt !== null ? [] : [
                { icon: 'edit', label: '修改授权', disabled: busy || row.legacyScheduleId !== null || ended,
                  onSelect: () => { setEdit({ row, draft: grantInput(row) }); setRevoke(null); } },
                { icon: 'close', label: '撤销授权', danger: true, disabled: busy,
                  onSelect: () => { setRevoke(row.id); setEdit(null); } },
              ]} />
            </div>
            {edit?.row.id !== row.id ? null : <div className="outbound-inline-edit">
              <GrantFields value={edit.draft} onChange={(draft) => setEdit({ ...edit, draft })}
                choices={choices} disabled={busy} />
              <div className="outbound-edit-actions"><button type="button" className="primary-button"
                disabled={busy || !validGrant(edit.draft)} onClick={() => {
                  void write(`edit:${row.id}:${JSON.stringify(edit.draft)}`, (requestId) => api.outbound.edit(row.id,
                    { requestId, version: edit.row.version, patch: edit.draft }));
                }}>保存授权</button><button type="button" className="secondary-button" disabled={busy}
                  onClick={() => setEdit(null)}>取消修改</button></div>
            </div>}
            {revoke !== row.id ? null : <div className="outbound-revoke" role="group" aria-label="确认撤销授权">
              <p>撤销后，后续发送需要重新确认；已经发出的内容不会收回。</p>
              <div className="outbound-edit-actions"><button type="button" className="danger-button" disabled={busy}
                onClick={() => { void write(`revoke:${row.id}:${row.version}`, (requestId) =>
                  api.outbound.revoke(row.id, { requestId, version: row.version })); }}>确认撤销</button>
                <button type="button" className="secondary-button" disabled={busy}
                  onClick={() => setRevoke(null)}>取消</button></div>
            </div>}
          </div>;
        })}
      </div>
      {error === null ? null : <p className="settings-message" role="alert">{error}</p>}
    </section>
    {logs.length === 0 ? null : <section className="block" aria-label="自动发出的">
      <SectionHead title="自动发出的" />
      <div className="outbound-logs">{logs.map((entry) => <div className="outbound-log" key={entry.id}>
        <div className="outbound-log-row"><time dateTime={entry.createdAt}>{shortAt(entry.createdAt)}</time>
          <span className="grant-avatar grant-avatar-small" aria-hidden="true">
            {entry.actor === MAIN_ACTOR ? 'P' : actorLabel(entry.actor, choices.actors).slice(0, 1)}</span>
          <span className="outbound-log-summary">{channelLabel(entry.channel)} · {entry.recipients.length} 位 ·
            {' '}{entry.content}</span>
          <button type="button" className="text-button" aria-expanded={opened === entry.id}
            onClick={() => setOpened(opened === entry.id ? null : entry.id)}>
            {opened === entry.id ? '收起原文' : '看原文'}</button></div>
        {entry.status === 'sent' || entry.status === 'completed' ? null :
          <p className="outbound-log-status" data-error={entry.status === 'failed'}>{LOG_LABELS[entry.status]}</p>}
        {opened !== entry.id ? null : <div className="outbound-log-body">
          <p>{LOG_LABELS[entry.status]} · {entry.summary}</p><pre>{entry.content}</pre>
        </div>}
      </div>)}</div>
    </section>}
  </div>;
}

function shortAt(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    hour12: false }).format(new Date(value));
}
