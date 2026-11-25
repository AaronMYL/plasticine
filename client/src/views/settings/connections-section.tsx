import { useEffect, useState, type ReactNode } from 'react';
import { useApi } from '../../api/context.tsx';
import { errorText } from '../../api/errors.ts';
import { createRequestId } from '../../api/request-id.ts';
import type { ConnectionView } from '../../api/shared.ts';
import { useLive, useTimeZone } from '../../live.tsx';
import { BusyText } from '../../primitives/busy/index.tsx';
import { showToast } from '../../primitives/toast/index.tsx';
import { ConfirmDialog } from '../../shell/confirm-dialog.tsx';
import { DropdownMenu, SEPARATOR } from '../../shell/dropdown-menu.tsx';
import { Icon } from '../../shell/icons.tsx';
import { timeText } from '../../shell/time-text.ts';
import { ConnectionDialog } from './connection-dialog.tsx';
import { SectionHead } from './section-head.tsx';
import { useRead } from './system-read.tsx';
import './connections.css';

const CONNECTIONS_TIP = '连一个给了连接地址（MCP）的服务，Plasticine 就能用它的工具：只读的直接用，会改东西的按承诺和授权。'
  + '令牌存在服务器上，不经聊天。';

type Dialog = { kind: 'add' } | { kind: 'edit'; connection: ConnectionView } | { kind: 'remove';
  connection: ConnectionView };

function subText(connection: ConnectionView, timeZone: string): string {
  if (connection.status === 'error') {
    const when = connection.checkedAt === null ? '' : `（${timeText(connection.checkedAt, new Date(), timeZone)}）`;
    return `没连上：${connection.error ?? '对面没回'}${when}`;
  }
  if (connection.status === 'untested') return '还没测过';
  const writes = connection.tools.some((tool) => !tool.readOnly);
  return `${connection.tools.length} 个工具${writes ? ' · 读的直接用，会改的按承诺和授权' : ''}`;
}

function ConnectionRow({ connection, onEdit, onRemove, onChanged }: { connection: ConnectionView;
  onEdit: () => void; onRemove: () => void; onChanged: (next: ConnectionView) => void }): ReactNode {
  const api = useApi();
  const timeZone = useTimeZone();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const run = (work: () => Promise<ConnectionView>): void => {
    setBusy(true);
    work().then(onChanged, (cause: unknown) => showToast({ text: errorText(cause), tone: 'error' }))
      .finally(() => setBusy(false));
  };
  const failed = connection.status === 'error';
  return (
    <li className="conn-item">
      <div className="set-row conn-row">
        <span className="set-row-lead"><Icon name="link" size={16} /></span>
        <button type="button" className="conn-row-main" aria-expanded={open} disabled={connection.tools.length === 0}
          onClick={() => setOpen(!open)}>
          <span className="set-row-name">{connection.name}</span>
          <span className="set-row-sub" data-error={failed ? '' : undefined}>{subText(connection, timeZone)}</span>
        </button>
        {connection.tools.length === 0 ? null
          : <Icon name={open ? 'chevron-up' : 'chevron-down'} size={16} />}
        <span className="set-row-control">
          {failed ? <button type="button" className="secondary-button button-small" disabled={busy}
            onClick={() => run(() => api.connections.test(connection.id))}><BusyText busy={busy}>重试</BusyText>
          </button> : <input type="checkbox" role="switch" aria-label={`用「${connection.name}」`}
            checked={connection.enabled} disabled={busy}
            onChange={(event) => {
              const enabled = event.currentTarget.checked;
              run(() => api.connections.update(connection.id, { requestId: createRequestId(), enabled }));
            }} />}
          <DropdownMenu label={`${connection.name}的更多操作`} tip="更多" className="icon-button" align="end" rowMenu
            items={[
              { label: '编辑', icon: 'edit', onSelect: onEdit },
              { label: '现在测一次', icon: 'refresh', onSelect: () => run(() => api.connections.test(connection.id)) },
              SEPARATOR,
              { label: '删除', icon: 'trash', danger: true, onSelect: onRemove },
            ]}>
            <Icon name="more" size={16} />
          </DropdownMenu>
        </span>
      </div>
      {open ? (
        <ul className="conn-tools" aria-label={`${connection.name}给的工具`}>
          {connection.tools.map((tool) => (
            <li key={tool.name} className="conn-tool"
              data-tip={tool.description === '' ? undefined : tool.description}>
              <span className="conn-tool-name">{tool.name}</span>
              <span className="tag tag-outline-quiet">{tool.readOnly ? '只读' : '会改：按承诺和授权'}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function ConnectionsSection(): ReactNode {
  const api = useApi();
  const live = useLive();
  const list = useRead((signal) => api.connections.list(signal), [api]);
  const [items, setItems] = useState<ConnectionView[] | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [removing, setRemoving] = useState(false);
  useEffect(() => setItems(list.value), [list.value]);
  useEffect(() => live.hub.on((event) => {
    if (event.type === 'connections.changed') list.reload();
  }), [live.hub]);
  const replace = (next: ConnectionView): void => setItems((current) => {
    const list = current ?? [];
    return list.some((item) => item.id === next.id) ? list.map((item) => (item.id === next.id ? next : item))
      : [...list, next];
  });
  const remove = (connection: ConnectionView): void => {
    setRemoving(true);
    api.connections.remove(connection.id).then(() => {
      setItems((current) => (current ?? []).filter((item) => item.id !== connection.id));
      setDialog(null);
    }, (cause: unknown) => showToast({ text: errorText(cause), tone: 'error' })).finally(() => setRemoving(false));
  };
  return (
    <section className="block" aria-labelledby="settings-connections">
      <SectionHead id="settings-connections" title="连接" tip={CONNECTIONS_TIP}>
        <button type="button" className="secondary-button button-small conn-add"
          onClick={() => setDialog({ kind: 'add' })}>添加连接</button>
      </SectionHead>
      {list.error === null ? null : <p className="block-empty is-error" role="alert">没读到连接：{list.error}</p>}
      {items !== null && items.length === 0 ? <p className="block-empty">还没有连接。</p> : null}
      {items === null || items.length === 0 ? null : (
        <ul className="conn-list">
          {items.map((connection) => (
            <ConnectionRow key={connection.id} connection={connection} onChanged={replace}
              onEdit={() => setDialog({ kind: 'edit', connection })}
              onRemove={() => setDialog({ kind: 'remove', connection })} />
          ))}
        </ul>
      )}
      {dialog?.kind === 'add' || dialog?.kind === 'edit' ? (
        <ConnectionDialog connection={dialog.kind === 'edit' ? dialog.connection : null} onSaved={replace}
          onRemoved={(id) => setItems((current) => (current ?? []).filter((item) => item.id !== id))}
          onClose={() => setDialog(null)} />
      ) : null}
      {dialog?.kind === 'remove' ? (
        <ConfirmDialog title={`删除「${dialog.connection.name}」？`} confirmLabel="删除" busy={removing}
          body="Plasticine 不再用它的工具，存着的令牌一起删除。" onCancel={() => setDialog(null)}
          onConfirm={() => remove(dialog.connection)} />
      ) : null}
    </section>
  );
}
