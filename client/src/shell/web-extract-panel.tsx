import type { ReactNode } from 'react';
import { IconButton } from './icon-button.tsx';
import { pushHash } from './nav-history.ts';
import { routeHash } from './routes.ts';
import { spaceRoute } from '../views/spaces/space-links.ts';
import { HIT_REGION_ATTRIBUTE } from './hit-regions.ts';
import type { useWebExtract } from './use-web-extract.ts';
import './web-extract.css';

export function WebExtractPanel({ extract }: { extract: ReturnType<typeof useWebExtract> }): ReactNode {
  if (!extract.open) return null;
  return <aside className="web-extract" aria-label="网页重点" {...{ [HIT_REGION_ATTRIBUTE]: 'web-extract' }}>
    <header><strong>{extract.busy === 'extract' ? '正在提取…' : `提取到 ${extract.page?.points.length ?? 0} 条`}</strong>
      <IconButton icon="refresh" label="重新提取" disabled={extract.busy !== null}
        onClick={() => void extract.extract()} />
      <IconButton icon="close" label="收起网页重点" onClick={extract.close} /></header>
    {extract.error === null ? null : <p role="alert" className="is-error">{extract.error}</p>}
    <ol>{extract.page?.points.map((point, index) => <li key={`${point.block}:${point.quote}`}>
      <button type="button" className="web-extract-point" onClick={() => extract.jump(index)}>{point.text}</button>
      <IconButton icon="close" label="去掉这条重点" disabled={extract.busy !== null}
        onClick={() => extract.remove(index)} /></li>)}</ol>
    {extract.page === null ? null : <footer>{extract.spaceId === null
      ? <button type="button" className="primary-button" disabled={extract.busy !== null}
        onClick={() => void extract.archive()}>{extract.busy === 'archive' ? '正在归档…' : '归档到资料库'}</button>
      : <button type="button" className="primary-button"
        onClick={() => pushHash(routeHash(spaceRoute(extract.spaceId!)))}>打开归档</button>}</footer>}
  </aside>;
}
