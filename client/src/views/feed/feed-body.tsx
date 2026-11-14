// 信息流卡片的正文（《优化清单》第 8、9 条）：
// - 中文：抓取时存好的译文（feed-text.ts 挑显示什么）。短帖直接是中文全文 +「译自英文 · 看原文」；长帖先是中文摘要，
//   「展开」原地展开中文全文（高度平滑过渡），展开后能切原文、能收起。截出来的末尾渐隐。
// - 小图表：服务端只用文章里明写的数字画（数字逐个核对过），注明来源；没有就不画。
// - 抖音收藏：核心观点列成几条，「和你有关」的那条单列。

import { useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { FeedChart } from '../../api/shared.ts';
import type { FeedItemView } from '../../api/types.ts';
import { hueVar } from '../../shell/hue.tsx';
import { Icon } from '../../shell/icons.tsx';
import { useHeightMorph } from '../../shell/motion.ts';
import { feedText } from './feed-text.ts';
import { ArticleBody, useArticle } from './feed-article.tsx';
import './feed-body.css';

type Mode = 'lead' | 'full' | 'original';

/** 标题 + 正文 + 展开 / 原文切换；存了全文的博客文章多一个「读全文」（第13批）。 */
export function FeedText({ item }: { item: FeedItemView }): ReactNode {
  const text = feedText(item);
  const [mode, setMode] = useState<Mode>('lead');
  const ref = useRef<HTMLDivElement>(null);
  const { article, load, close } = useArticle(item.id);
  useHeightMorph(ref, `${mode}:${article.state}`);
  if (article.state === 'ready' || article.state === 'loading' || article.state === 'failed') {
    return (
      <div ref={ref} className="feed-text" data-mode="article">
        <h3 className="feed-card-title">{item.title}</h3>
        {article.state === 'ready' ? <ArticleBody blocks={article.blocks} />
          : article.state === 'loading' ? <p className="feed-article-note" role="status">正在读全文</p>
            : <p className="feed-article-note is-error" role="alert">{article.error}{' '}
              <button type="button" className="text-button" onClick={load}>再读一次</button></p>}
        <div className="feed-text-tools">
          <button type="button" className="feed-text-toggle" aria-expanded={true} onClick={close}>
            收起<Icon name="chevron-up" size={12} />
          </button>
        </div>
      </div>
    );
  }
  const post = item.kind === 'x';
  const body = mode === 'lead' ? text.lead : mode === 'full' ? text.full : text.original;
  const title = mode === 'original' ? item.title : text.title;
  // 长帖展开前只有「展开」；展开后（和短帖）才有「译自… · 看原文」。
  const canSwitch = text.from !== null && (mode !== 'lead' || !text.expandable);
  const translatedMode: Mode = text.expandable ? 'full' : 'lead';
  return (
    <div ref={ref} className="feed-text" data-mode={mode}>
      {post ? null : <h3 className="feed-card-title" lang={mode === 'original' ? 'und' : undefined}>{title}</h3>}
      {body === '' ? null : (
        <p className={['feed-card-text', post ? 'is-post' : '', mode === 'lead' && text.faded ? 'is-faded' : '']
          .filter(Boolean).join(' ')}>{body}</p>
      )}
      {text.expandable || canSwitch || item.hasBody === true ? (
        <div className="feed-text-tools">
          {item.hasBody === true && mode === 'lead' ? (
            <button type="button" className="feed-text-toggle" aria-expanded={false} onClick={load}>
              读全文<Icon name="chevron-down" size={12} />
            </button>
          ) : null}
          {text.expandable && mode === 'lead' ? (
            <button type="button" className="feed-text-toggle" aria-expanded={false} onClick={() => setMode('full')}>
              展开<Icon name="chevron-down" size={12} />
            </button>
          ) : null}
          {canSwitch ? (
            <span className="feed-text-from">
              <Icon name="translate" size={12} />
              <span>译自{text.from}</span>
              <button type="button" className="feed-text-link" aria-pressed={mode === 'original'}
                onClick={() => setMode(mode === 'original' ? translatedMode : 'original')}>
                {mode === 'original' ? '看译文' : '看原文'}
              </button>
            </span>
          ) : null}
          {text.expandable && mode !== 'lead' ? (
            <button type="button" className="feed-text-toggle" aria-expanded={true} onClick={() => setMode('lead')}>
              收起<Icon name="chevron-up" size={12} />
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

const CHART_WIDTH = 280;
const CHART_HEIGHT = 64;
// 线不贴着上下边：留 6px。
const CHART_PAD = 6;

/** 折线按数据的高低铺满；柱子从 0 起（柱高要和数成比例）。 */
function scaled(values: readonly number[], bars: boolean): { y: (value: number) => number } {
  const min = bars ? Math.min(0, ...values) : Math.min(...values);
  const max = Math.max(...values);
  const span = max - min === 0 ? 1 : max - min;
  return { y: (value) => CHART_HEIGHT - CHART_PAD - ((value - min) / span) * (CHART_HEIGHT - CHART_PAD * 2) };
}

/** 一张小图表：一条折线或一组柱子，下面一行写画的是什么、数据从哪来。 */
export function FeedChartView({ chart }: { chart: FeedChart }): ReactNode {
  const values = chart.points.map((point) => point.value);
  const { y } = scaled(values, chart.kind === 'bar');
  const step = chart.points.length > 1 ? CHART_WIDTH / (chart.points.length - 1) : CHART_WIDTH;
  const unit = chart.unit ?? '';
  const label = `${chart.caption}：${chart.points.map((point) => `${point.label} ${point.value}${unit}`).join('，')}`;
  const barWidth = Math.max(4, CHART_WIDTH / chart.points.length - 6);
  return (
    // 颜色是类别色里的青绿（设计稿 Feed），就地设成 --card-hue，线和柱子都用它。
    <figure className="feed-chart" style={{ '--card-hue': hueVar('teal') } as CSSProperties}>
      <svg width="100%" height={CHART_HEIGHT} viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        preserveAspectRatio="none" role="img" aria-label={label}>
        {chart.kind === 'line' ? (
          <path className="feed-chart-line" vectorEffect="non-scaling-stroke"
            d={chart.points.map((point, index) => `${index === 0 ? 'M' : 'L'}${index * step} ${y(point.value)}`)
              .join(' ')} />
        ) : chart.points.map((point, index) => (
          <rect key={point.label} className="feed-chart-bar" x={(CHART_WIDTH / chart.points.length) * index + 3}
            width={barWidth} y={y(point.value)} height={CHART_HEIGHT - y(point.value)} rx={2} />
        ))}
        <line className="feed-chart-axis" x1={0} x2={CHART_WIDTH} y1={CHART_HEIGHT - 0.5} y2={CHART_HEIGHT - 0.5}
          vectorEffect="non-scaling-stroke" />
      </svg>
      <figcaption className="feed-chart-caption">{chart.caption} · 来源：{chart.source}</figcaption>
    </figure>
  );
}

/** 抖音收藏总结来的：标题 + 核心观点几条 +「和你有关」。 */
export function FeedVideoBody({ item }: { item: FeedItemView }): ReactNode {
  const video = item.video ?? null;
  const points = video?.points ?? [];
  const related = video?.related ?? [];
  return (
    <>
      <h3 className="feed-card-title">{item.title}</h3>
      {points.length + related.length === 0 ? (
        item.summary === '' ? null : <p className="feed-card-text">{item.summary}</p>
      ) : (
        <ul className="feed-points">
          {points.map((point) => <li key={point}>{point}</li>)}
          {related.map((point) => (
            <li key={point} className="is-related">{point.startsWith('和你有关') ? point : `和你有关：${point}`}</li>
          ))}
        </ul>
      )}
    </>
  );
}

function clock(seconds: number): string {
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/** 抖音卡头部第二行：「视频 3:42 · 已总结」。 */
export function videoMeta(item: FeedItemView): string {
  const video = item.video ?? null;
  if (video === null) {
    return '抖音';
  }
  const what = video.kind === 'images' ? '图文' : video.durationSeconds === null ? '视频'
    : `视频 ${clock(video.durationSeconds)}`;
  const stage = { synced: '已同步', previewed: '已预览', transcribed: '已转写', summarized: '已总结' }[video.stage];
  return `${what} · ${stage}`;
}

/** 抖音卡的来源方块：玫瑰色淡底 +「抖」。 */
export function DouyinMark(): ReactNode {
  return (
    <span className="feed-mark is-square hue-tile" style={{ '--tile-hue': hueVar('rose') } as CSSProperties}
      aria-hidden="true">抖</span>
  );
}
