// 空间正文的读法（设计稿 Library-Space）：小节标题（目录就是它们）、正文（[^n] 成上标）、图表、图片、引用，
// 最后一节「出处」按编号列出，每条能点回原对话、项目或原文。

import type { ReactNode } from 'react';
import type { SpaceBlock, SpaceDoc, SpaceSource } from '../../api/shared.ts';
import { Markdown } from '../../primitives/message/markdown.tsx';
import { SpaceChartView } from './space-chart.tsx';
import { sourceHref, superscript, withFootnotes } from './space-links.ts';

function SourceLink({ source, children }: { source: SpaceSource; children?: ReactNode }): ReactNode {
  const href = sourceHref(source);
  if (href === null) {
    return <span>{children ?? source.label}</span>;
  }
  return <a className="space-src" href={href} {...(href.startsWith('#') ? {} : { target: '_blank', rel: 'noreferrer' })}>
    {children ?? source.label}</a>;
}

function Block({ block }: { block: SpaceBlock }): ReactNode {
  switch (block.type) {
    case 'heading':
      return <h2 id={`space-${block.id}`} className="space-h">{block.text}</h2>;
    case 'text':
      return <div className="space-text"><Markdown text={withFootnotes(block.markdown)} /></div>;
    case 'chart':
      return <SpaceChartView chart={block} />;
    case 'image':
      return (
        <figure className="space-image">
          <img src={block.url} alt={block.alt} loading="lazy" />
          <figcaption className="text-meta">{block.caption === undefined ? null : <span>{block.caption} · </span>}
            来源：<SourceLink source={block.source} /></figcaption>
        </figure>
      );
    case 'quote':
      return (
        <blockquote className="space-quote">
          <p>{block.text}</p>
          <footer className="text-meta"><SourceLink source={block.source} /></footer>
        </blockquote>
      );
  }
}

export function SpaceBlocks({ doc }: { doc: SpaceDoc }): ReactNode {
  return (
    <>
      {doc.blocks.map((block, index) => <Block key={block.type === 'heading' ? block.id : index} block={block} />)}
      {doc.sources.length === 0 ? null : (
        <section className="space-sources" aria-label="出处">
          <h2 className="space-h">出处</h2>
          <ol>
            {doc.sources.map((source, index) => <li key={`${source.label}-${index}`} className="text-meta">
              <span className="space-sources-n">{superscript(index + 1)}</span><SourceLink source={source} />
            </li>)}
          </ol>
        </section>
      )}
    </>
  );
}

/** 结论大标题下面那一排数字卡。 */
export function SpaceStats({ stats }: { stats: SpaceDoc['stats'] }): ReactNode {
  if (stats.length === 0) {
    return null;
  }
  return (
    <dl className="space-stats">
      {stats.map((stat) => <div key={stat.label} className="space-stat">
        <dd>{stat.value}</dd><dt className="text-meta">{stat.label}</dt>
      </div>)}
    </dl>
  );
}
