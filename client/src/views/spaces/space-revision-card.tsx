import { useCallback, useState, type ReactNode } from 'react';
import type { SpaceToolResult } from '../../../../agent/shared/space-result.ts';
import { spaceParagraphs } from '../../../../agent/shared/space-selection.ts';
import { useApi } from '../../api/context.tsx';
import { Sheet } from '../../primitives/sheet/index.tsx';
import { Icon } from '../../shell/icons.tsx';
import { PHONE_BELOW } from '../../shell/layout.ts';
import { useRoute } from '../../shell/use-route.ts';
import { useViewportWidth } from '../../shell/use-viewport-width.ts';
import { useRead } from '../memory/use-read.ts';
import { spaceRoute } from './space-links.ts';
import './space-revision-card.css';

function Changes({ result, onClose }: { result: SpaceToolResult; onClose: () => void }): ReactNode {
  const api = useApi();
  const { navigate } = useRoute();
  const phone = useViewportWidth() < PHONE_BELOW;
  const read = useCallback(async (signal: AbortSignal) => {
    const after = (await api.spaces.versions(result.id, result.version, signal)).selected;
    const before = result.version < 2 ? null
      : (await api.spaces.versions(result.id, result.version - 1, signal)).selected;
    const oldText = spaceParagraphs(before?.html ?? '').map((paragraph) => paragraph.text);
    const newText = spaceParagraphs(after?.html ?? '').map((paragraph) => paragraph.text);
    return Array.from({ length: Math.max(oldText.length, newText.length) }, (_, index) => ({
      paragraph: index + 1, before: oldText[index] ?? '', after: newText[index] ?? '',
    })).filter((entry) => entry.before !== entry.after);
  }, [api, result.id, result.version]);
  const { value, error, reload } = useRead(read);
  return <Sheet open title={`第 ${result.version} 版的修改`} variant={phone ? 'drawer' : 'panel'} onClose={onClose}>
    <div className="space-change-list">
      {error === null ? null : <p role="alert">{error}
        <button className="text-button" type="button" onClick={reload}>重新读取</button></p>}
      {value?.map((entry) => <section className="space-change-row" key={entry.paragraph}>
        <h3>{`第 ${entry.paragraph} 段`}</h3>
        {entry.before === '' ? null : <p><del>{entry.before}</del></p>}
        {entry.after === '' ? null : <p><ins>{entry.after}</ins></p>}
      </section>)}
      {value?.length !== 0 ? null : <p>{result.change}</p>}
      <button type="button" className="text-button" onClick={() => {
        onClose();
        navigate({ ...spaceRoute(result.id), spacePosition: { version: result.version,
          paragraph: value?.[0]?.paragraph ?? 1 } });
      }}>打开这一版</button>
    </div>
  </Sheet>;
}

export function SpaceRevisionCard({ result }: { result: SpaceToolResult }): ReactNode {
  const [open, setOpen] = useState(false);
  return <>
    <div className="space-revision-card">
      <span className="space-revision-icon"><Icon name={result.genre === 'letter' ? 'mail' : 'file'} size={16} /></span>
      <span className="space-revision-summary"><span>{result.title}</span>
        <span className="text-meta">{`第 ${result.version} 版 · ${result.change}`}</span></span>
      <button type="button" className="text-button" onClick={() => setOpen(true)}>看改了什么</button>
    </div>
    {open ? <Changes result={result} onClose={() => setOpen(false)} /> : null}
  </>;
}
