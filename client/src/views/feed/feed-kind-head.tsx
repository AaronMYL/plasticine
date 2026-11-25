import { useState, type ReactNode } from 'react';
import { errorText } from '../../api/errors.ts';
import type { FeedNavSource } from '../../api/shared.ts';
import type { FeedSegment } from '../../state/feed-ui.ts';
import { kindChips, type KindGroup } from './feed-kinds.ts';
import { useSourceActions } from './feed-source-actions.ts';
import { SourceMenu } from './feed-source-menu.tsx';
import { showResultToast } from '../../primitives/toast/index.tsx';
import './feed-kinds.css';

export interface FeedKindHeadProps {
  group: KindGroup;
  segment: FeedSegment;
  titled: boolean;
  refresh: boolean;
  onShow: (segment: FeedSegment) => void;
  onSettings: (row: FeedNavSource) => void;
  onDouyin: () => void;
  onAdd: (kind: 'reddit' | 'url') => void;
}

export function useKindRefresh(group: KindGroup | null): { busy: boolean; run: () => void } {
  const actions = useSourceActions();
  const [busy, setBusy] = useState(false);
  return {
    busy,
    run: () => {
      if (group === null || busy) return;
      setBusy(true);
      actions.refreshAll(group.rows, group.label).then((result) => showResultToast(result.text, result.failed),
        (cause: unknown) => showResultToast(errorText(cause), true)).finally(() => setBusy(false));
    },
  };
}

export function FeedKindHead(props: FeedKindHeadProps): ReactNode {
  const { group, segment } = props;
  const chips = kindChips(group);
  const selected = chips.find((chip) => chip.segment === segment) ?? null;
  const own = selected?.row ?? null;
  const adds: Partial<Record<typeof group.kind, { label: string; onAdd: () => void }>> = {
    reddit: { label: '加版块…', onAdd: () => props.onAdd('reddit') },
    rss: { label: '加博客…', onAdd: () => props.onAdd('url') },
  };
  const add = own !== null ? undefined : adds[group.kind];
  const name = own?.label ?? group.label;
  const menu = <SourceMenu rows={own === null ? group.rows : [own]} label={`「${name}」的设置`} name={name}
    className="feed-kind-more" {...(add === undefined ? {} : { add })} onSettings={props.onSettings}
    onDouyin={props.onDouyin} afterRemove={group.rows.length > 1 ? group.kind : 'all'} />;
  const row = chips.length === 0 ? null : (
    <div className={`feed-chips${props.titled || props.refresh ? '' : ' feed-chips-scroll'}`} role="group"
      aria-label="看哪一处">
      {chips.map((chip) => (
        <button key={chip.segment} type="button" className="feed-chip" aria-pressed={chip.segment === segment}
          onClick={() => props.onShow(chip.segment)}>
          {chip.label}{chip.count === null || chip.count === 0 ? null
            : <span className="feed-chip-count">{chip.count}</span>}
        </button>
      ))}
    </div>
  );
  if (!props.titled && !props.refresh) {
    return row === null ? null : <div className="feed-kind-head is-compact">{row}{menu}</div>;
  }
  return (
    <div className="feed-kind-head">
      <div className="feed-kind-title">
        {props.titled ? <h2 className="feed-top-title">{group.label}</h2> : null}
        <span className="feed-kind-gap" />
        {menu}
      </div>
      {row}
    </div>
  );
}
