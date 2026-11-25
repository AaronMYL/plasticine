import { useRef, useState, type ReactNode } from 'react';
import {
  purposeInfo, THINKING_LABELS,
  type ListModelProvidersResponse, type ModelChoiceView, type ModelPurpose,
} from '../../api/shared.ts';
import { useLive } from '../../live.tsx';
import { StatusGlyph } from '../../shell/glyph.tsx';
import { Icon } from '../../shell/icons.tsx';
import { anchorOf, type PopoverAnchor } from '../../shell/popover.tsx';
import { inheritLabel, ModelChooserPopover, type ChooserChange } from './model-chooser.tsx';

interface Shown {
  text: string;
  quiet: boolean;
}

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

interface RowProps {
  value: ListModelProvidersResponse;
  purpose: ModelPurpose | null;
  label: string;
  sub?: string;
  nested?: boolean;
  children?: ReactNode;
}

export function PurposeRow({ value, purpose, label, sub, nested = false, children }: RowProps): ReactNode {
  return <ChooserRow value={value} purposes={purpose === null ? null : [purpose]} label={label} sub={sub}
    nested={nested}>{children}</ChooserRow>;
}

export function MergedRow({ value, purposes, label, sub }: { value: ListModelProvidersResponse;
  purposes: readonly ModelPurpose[]; label: string; sub?: string }): ReactNode {
  return <ChooserRow value={value} purposes={purposes} label={label} sub={sub} />;
}

function ChooserRow({ value, purposes, label, sub, nested = false, children }: {
  value: ListModelProvidersResponse; purposes: readonly ModelPurpose[] | null; label: string; sub?: string | undefined;
  nested?: boolean; children?: ReactNode }): ReactNode {
  const live = useLive();
  const button = useRef<HTMLButtonElement>(null);
  const [anchor, setAnchor] = useState<PopoverAnchor | null>(null);
  const [error, setError] = useState<string | null>(null);
  const first = purposes?.[0] ?? null;
  const shown = purposes === null || purposes.length === 1 ? shownOf(value, first) : groupSummary(value, purposes);
  const issue = error ?? (purposes === null ? issueOf(value, null)
    : purposes.map((id) => issueOf(value, id)).find((text) => text !== null) ?? null);
  const choose = (change: ChooserChange): void => {
    const work = purposes === null
      ? change.model === null ? Promise.resolve(null)
        : live.models.chooseDefault({ ...change.model, thinking: change.thinking ?? 'medium' })
      : live.models.choosePurposes(purposes, change);
    void work.then(setError);
  };
  const focus = first === 'translation' ? 'translation-model' : undefined;
  return (
    <div className="ai-use" data-nested={nested} data-settings-focus={focus} tabIndex={focus === undefined ? undefined
      : -1}>
      <div className="ai-use-line">
        <span className="ai-use-name">{label}{sub === undefined ? null : <span className="ai-use-sub">{sub}</span>}
        </span>
        <button ref={button} type="button" className="ai-use-value" data-quiet={shown.quiet}
          aria-haspopup="dialog" aria-expanded={anchor !== null} aria-label={`${label}：${shown.text}`}
          onClick={(event) => setAnchor(anchor === null ? anchorOf(event.currentTarget) : null)}>
          <span>{shown.text}</span><Icon name="chevron-down" size={14} />
        </button>
        {children}
      </div>
      {issue === null ? null : (
        <p className="ai-use-issue" role={error === null ? undefined : 'alert'}>
          <StatusGlyph status="err" label="出错" />{issue}
        </p>
      )}
      {anchor === null ? null : (
        <ModelChooserPopover anchor={anchor} label={`${label}用的模型`} trigger={button} value={value}
          purpose={first} onChoose={choose} onClose={() => setAnchor(null)} />
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

export function FoldedRows({ value, purposes, label, sub }: { value: ListModelProvidersResponse;
  purposes: readonly ModelPurpose[]; label: string; sub?: string }): ReactNode {
  const hasIssue = purposes.some((id) => issueOf(value, id) !== null);
  const [open, setOpen] = useState(hasIssue);
  const summary = groupSummary(value, purposes);
  return (
    <div className="ai-use-group">
      <div className="ai-use">
        <div className="ai-use-line">
          <button type="button" className="ai-use-name ai-use-fold" aria-expanded={open}
            aria-label={`${label} · ${purposes.length} 项`} onClick={() => setOpen(!open)}>
            {label}{sub === undefined ? null : <span className="ai-use-sub">{sub}</span>}
            {hasIssue && !open ? <StatusGlyph status="err" label="有一项出错" /> : null}
          </button>
          <button type="button" className="ai-use-value" data-quiet={summary.quiet} tabIndex={-1} aria-hidden="true"
            onClick={() => setOpen(!open)}>
            <span>{summary.text}</span><Icon name={open ? 'chevron-up' : 'chevron-down'} size={14} />
          </button>
        </div>
      </div>
      {open ? purposes.map((id) => (
        <PurposeRow key={id} value={value} purpose={id} label={purposeInfo(id).label} nested />
      )) : null}
    </div>
  );
}
