// 设置 · AI 右边「各用哪个」（《优化清单》第 13 条，设计稿 Settings-AI）：默认在最上；每个功能一行，点右边的模型
// 出共用的选模型弹层，选了马上存。笔记 8 项、图书 3 项这类成组的折成一行，点开再分开配；「跟默认」用浅色字。
// 选到的模型后来取消启用、或那家断开：这一行回到默认，下面写一句原因（只有出错写字）。

import { useRef, useState, type ReactNode } from 'react';
import {
  MODEL_PURPOSE_GROUPS, MODEL_PURPOSES, purposeInfo, THINKING_LABELS,
  type ListModelProvidersResponse, type ModelChoiceView, type ModelPurpose, type ModelPurposeGroup,
} from '../../api/shared.ts';
import { useLive } from '../../live.tsx';
import { StatusGlyph } from '../../shell/glyph.tsx';
import { Icon } from '../../shell/icons.tsx';
import { anchorOf, type PopoverAnchor } from '../../shell/popover.tsx';
import { useStore } from '../../state/use-store.ts';
import { inheritLabel, ModelChooserPopover, type ChooserChange } from './model-chooser.tsx';

interface Shown {
  text: string;
  /** 跟着默认 / 主线 / 便宜的那个：浅色字。 */
  quiet: boolean;
}

/** 「GPT-5.5 · 高」；不分思考档的模型只写名字。 */
function choiceText(value: ListModelProvidersResponse, choice: ModelChoiceView | null): string {
  if (choice === null) {
    return '先连接模型';
  }
  const model = value.providers.find((item) => item.id === choice.provider)?.models
    .find((item) => item.id === choice.model);
  const name = model?.name ?? choice.model;
  return (model?.thinkingLevels.length ?? 0) <= 1 ? name : `${name} · ${THINKING_LABELS[choice.thinking]}`;
}

function shownOf(value: ListModelProvidersResponse, purpose: ModelPurpose | null): Shown {
  if (purpose === null) {
    return { text: choiceText(value, value.effective), quiet: false };
  }
  const view = value.purposes.find((item) => item.purpose === purpose);
  const chosen = view?.chosen ?? { model: null, thinking: null };
  const effective = view?.effective ?? null;
  const followsChosen = chosen.model !== null && effective !== null
    && effective.provider === chosen.model.provider && effective.model === chosen.model.model;
  if (followsChosen) {
    return { text: choiceText(value, effective), quiet: false };
  }
  if (purposeInfo(purpose).fallback === 'cheap' && chosen.model === null) {
    return { text: choiceText(value, effective), quiet: true };
  }
  const thinking = chosen.thinking === null ? '' : ` · ${THINKING_LABELS[chosen.thinking]}`;
  return { text: `${inheritLabel(purpose)}${thinking}`, quiet: true };
}

function issueOf(value: ListModelProvidersResponse, purpose: ModelPurpose | null): string | null {
  return purpose === null ? value.defaultIssue
    : value.purposes.find((item) => item.purpose === purpose)?.issue ?? null;
}

function PurposeRow({ value, purpose, label, nested = false }: { value: ListModelProvidersResponse;
  purpose: ModelPurpose | null; label: string; nested?: boolean }): ReactNode {
  const live = useLive();
  const button = useRef<HTMLButtonElement>(null);
  const [anchor, setAnchor] = useState<PopoverAnchor | null>(null);
  const [error, setError] = useState<string | null>(null);
  const shown = shownOf(value, purpose);
  const issue = error ?? issueOf(value, purpose);
  const choose = (change: ChooserChange): void => {
    const work = purpose === null
      ? change.model === null ? Promise.resolve(null)
        : live.models.chooseDefault({ ...change.model, thinking: change.thinking ?? 'medium' })
      : live.models.choosePurpose(purpose, change);
    void work.then(setError);
  };
  const focus = purpose === 'translation' ? 'translation-model' : undefined;
  return (
    <div className="ai-use" data-nested={nested} data-settings-focus={focus} tabIndex={focus === undefined ? undefined
      : -1}>
      <div className="ai-use-line">
        <span className="ai-use-name">{label}</span>
        <button ref={button} type="button" className="ai-use-value" data-quiet={shown.quiet}
          aria-haspopup="dialog" aria-expanded={anchor !== null} aria-label={`${label}：${shown.text}`}
          onClick={(event) => setAnchor(anchor === null ? anchorOf(event.currentTarget) : null)}>
          <span>{shown.text}</span><Icon name="chevron-down" size={12} />
        </button>
      </div>
      {issue === null ? null : (
        <p className="ai-use-issue" role={error === null ? undefined : 'alert'}>
          <StatusGlyph status="err" label="出错" />{issue}
        </p>
      )}
      {anchor === null ? null : (
        <ModelChooserPopover anchor={anchor} label={`${label}用的模型`} trigger={button} value={value}
          purpose={purpose} onChoose={choose} onClose={() => setAnchor(null)} />
      )}
    </div>
  );
}

function groupSummary(value: ListModelProvidersResponse, ids: readonly ModelPurpose[]): Shown {
  const chosen = ids.map((id) => value.purposes.find((item) => item.purpose === id)?.chosen
    ?? { model: null, thinking: null });
  if (chosen.every((item) => item.model === null && item.thinking === null)) {
    return { text: '跟默认', quiet: true };
  }
  const first = ids[0];
  const same = chosen.every((item) => JSON.stringify(item) === JSON.stringify(chosen[0]));
  if (same && first !== undefined) {
    return shownOf(value, first);
  }
  const own = chosen.filter((item) => item.model !== null || item.thinking !== null).length;
  return { text: `${own} 项单独设`, quiet: false };
}

function GroupRows({ value, group, ids, query }: { value: ListModelProvidersResponse; group: ModelPurposeGroup;
  ids: readonly ModelPurpose[]; query: string }): ReactNode {
  const hasIssue = ids.some((id) => issueOf(value, id) !== null);
  const [open, setOpen] = useState(hasIssue);
  const label = MODEL_PURPOSE_GROUPS[group];
  const searching = query !== '';
  const members = searching && !label.toLowerCase().includes(query)
    ? ids.filter((id) => purposeInfo(id).label.toLowerCase().includes(query)) : ids;
  if (members.length === 0) {
    return null;
  }
  const expanded = open || searching;
  const summary = groupSummary(value, ids);
  return (
    <div className="ai-use-group">
      <div className="ai-use">
        <div className="ai-use-line">
          <button type="button" className="ai-use-name ai-use-fold" aria-expanded={expanded}
            onClick={() => setOpen(!expanded)}>
            {label} · {ids.length} 项
            {hasIssue && !expanded ? <StatusGlyph status="err" label="有一项出错" /> : null}
          </button>
          <button type="button" className="ai-use-value" data-quiet={summary.quiet} tabIndex={-1} aria-hidden="true"
            onClick={() => setOpen(!expanded)}>
            <span>{summary.text}</span><Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={12} />
          </button>
        </div>
      </div>
      {expanded ? members.map((id) => (
        <PurposeRow key={id} value={value} purpose={id} label={purposeInfo(id).label} nested />
      )) : null}
    </div>
  );
}

export function AiPurposes(): ReactNode {
  const live = useLive();
  const data = useStore(live.models.store);
  const [query, setQuery] = useState('');
  const value = data.value;
  const needle = query.trim().toLowerCase();
  const matches = (text: string): boolean => needle === '' || text.toLowerCase().includes(needle);
  const seen = new Set<ModelPurposeGroup>();
  return (
    <section className="ai-pane" aria-labelledby="ai-uses-title">
      <div className="ai-pane-head">
        <h3 id="ai-uses-title">各用哪个</h3>
        <label className="model-search ai-use-search">
          <Icon name="search" size={13} />
          <input type="search" className="search-input" aria-label="搜功能" placeholder="搜功能" value={query}
            onChange={(event) => setQuery(event.target.value)} />
        </label>
      </div>
      {value === null ? null : (
        <div className="ai-use-list">
          {matches('默认') ? <PurposeRow value={value} purpose={null} label="默认" /> : null}
          {MODEL_PURPOSES.map(({ id, label, group }) => {
            if (group === null) {
              return matches(label) ? <PurposeRow key={id} value={value} purpose={id} label={label} /> : null;
            }
            if (seen.has(group)) {
              return null;
            }
            seen.add(group);
            const ids = MODEL_PURPOSES.filter((item) => item.group === group).map((item) => item.id);
            return <GroupRows key={group} value={value} group={group} ids={ids} query={needle} />;
          })}
        </div>
      )}
    </section>
  );
}
