// 设置 · AI 最上面的「用量」（11-18 Aaron：「再在设置-AI 中增加一个AI用量统计」；设计稿「Plasticine AI 用量统计」弹框选
// 「照做，但放 AI 页最上面」）。段头右边分段切今天 / 7 天 / 30 天；四个数（请求、输入和缓存命中、输出、估算费用）；
// 每天（今天按小时）一根柱子，指到柱子上浮出那一天的数；下面分段按模型 / 按用途，每行底下一段蓝条是占比。
// 费用是按各模型 API 价估的，订阅登录的实际不按这个收（ⓘ 里写明）。切范围时先留着上一份，新的到了再换。

import { useEffect, useState, type ReactNode } from 'react';
import { useApi } from '../../api/context.tsx';
import { errorText } from '../../api/errors.ts';
import { USAGE_RANGE_LABELS, USAGE_RANGES, type ModelUsageReport, type UsageAmount, type UsageBucket,
  type UsageGroup, type UsageRange } from '../../api/shared.ts';
import { useTimeZone } from '../../live.tsx';
import { chartScale } from '../../primitives/chart/chart-scale.ts';
import { PageLoading } from '../../primitives/page-loading/index.tsx';
import { InfoTip } from '../../shell/info-tip.tsx';
import { SectionHead } from '../settings/section-head.tsx';
import './usage.css';

type UsageView = 'model' | 'purpose';

const COST_TIP = '按各模型的 API 价估的；订阅登录的实际不按这个收。';
/** 画布高，和 usage.css 的 .usage-chart-plot 一样（柱子按这个算像素高）。 */
const PLOT_HEIGHT = 168;

/** token 数写短：311M、12.3M、652K、980。 */
export function tokenText(count: number): string {
  if (count >= 100_000_000) return `${Math.round(count / 1_000_000)}M`;
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (count >= 100_000) return `${Math.round(count / 1_000)}K`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return String(count);
}

/** 估算费用：100 美元以上写整数，以下写到分；一次带价格的都没有写「没有价格」。 */
export function costText(amount: Pick<UsageAmount, 'cost' | 'priced'>): string {
  if (!amount.priced) return '没有价格';
  return amount.cost >= 100 ? `$${Math.round(amount.cost).toLocaleString('en-US')}` : `$${amount.cost.toFixed(2)}`;
}

function tokensOf(amount: UsageAmount): number {
  return amount.input + amount.output;
}

function Stats({ total }: { total: UsageAmount }): ReactNode {
  const hit = total.input === 0 ? 0 : Math.round(total.cacheRead / total.input * 100);
  return (
    <dl className="usage-stats">
      <div className="usage-stat"><dt>请求</dt><dd className="usage-stat-value">
        {total.requests.toLocaleString('en-US')}</dd>
        <dd className="usage-stat-sub">平均每次 {tokenText(Math.round(total.input / Math.max(total.requests, 1)))}
        </dd></div>
      <div className="usage-stat"><dt>输入</dt><dd className="usage-stat-value">{tokenText(total.input)}</dd>
        <dd className="usage-stat-sub">缓存命中 {hit}%</dd></div>
      <div className="usage-stat"><dt>输出</dt><dd className="usage-stat-value">{tokenText(total.output)}</dd>
        <dd className="usage-stat-sub">token</dd></div>
      <div className="usage-stat"><dt>估算费用<InfoTip label="估算费用的说明" text={COST_TIP} /></dt>
        <dd className="usage-stat-value">{costText(total)}</dd><dd className="usage-stat-sub">按 API 价</dd></div>
    </dl>
  );
}

function axisEvery(count: number): number {
  return count > 24 ? 5 : count > 12 ? 3 : 1;
}

function currentHour(timeZone: string): number {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hourCycle: 'h23' }).format(new Date()))
    % 24;
}

function Chart({ buckets, range, timeZone }: { buckets: readonly UsageBucket[]; range: UsageRange;
  timeZone: string }): ReactNode {
  const values = buckets.map((bucket) => tokensOf(bucket.amount));
  const scale = chartScale(values.length === 0 ? [0] : [...values, 1], true);
  const top = Math.max(scale.max, 1);
  const every = axisEvery(buckets.length);
  // 点出「现在」：7 天、30 天是最后一根（今天），今天是这一小时那根；横轴上也留着它的字。
  const last = range === 'today' ? currentHour(timeZone) : buckets.length - 1;
  const unit = range === 'today' ? '每小时' : '每天';
  const label = (bucket: UsageBucket): string => (range === 'today' ? `${bucket.label}:00` : bucket.label);
  const barHeight = (bucket: UsageBucket): number => Math.round(tokensOf(bucket.amount) / top * PLOT_HEIGHT * 10) / 10;
  return (
    <figure className="usage-chart" aria-label={`${USAGE_RANGE_LABELS[range]}${unit}用掉的 token`}>
      <div className="usage-chart-plot">
        <div className="usage-chart-ticks" aria-hidden="true">
          {scale.ticks.map((tick) => <span key={tick} style={{ top: `${(1 - tick / top) * 100}%` }}>
            {tokenText(tick)}</span>)}
        </div>
        <div className="usage-chart-area">
          {scale.ticks.map((tick) => <span key={tick} className="usage-chart-line" aria-hidden="true"
            style={{ top: `${(1 - tick / top) * 100}%` }} />)}
          <ol className="usage-chart-bars">
            {buckets.map((bucket, index) => (
              <li key={bucket.start + bucket.label} className={`usage-chart-bar${index === last ? ' is-last' : ''}`}
                aria-label={`${label(bucket)}：${tokenText(tokensOf(bucket.amount))} token，`
                  + `${bucket.amount.requests} 次`}>
                {/* 指的地方是柱子本身（矮的至少 12 高），浮框出在柱顶上。 */}
                <span className="usage-chart-hit" style={{ height: `max(${barHeight(bucket)}px, 12px)` }}
                  data-tip={`${label(bucket)} · ${tokenText(tokensOf(bucket.amount))} token · `
                    + `${bucket.amount.requests.toLocaleString('en-US')} 次 · ${costText(bucket.amount)}`}>
                  <span style={{ height: `${barHeight(bucket)}px` }} />
                </span>
              </li>
            ))}
          </ol>
        </div>
      </div>
      <div className="usage-chart-axis" aria-hidden="true">
        {buckets.map((bucket, index) => <span key={bucket.start + bucket.label}>
          {index % every === 0 || (index === last && range !== 'today') ? bucket.label : ''}</span>)}
      </div>
    </figure>
  );
}

function groupSub(group: UsageGroup, view: UsageView): string {
  const times = `${group.amount.requests.toLocaleString('en-US')} 次`;
  if (view === 'model') return group.provider === undefined ? times : `${group.provider} · ${times}`;
  return group.lines === undefined ? times : `${group.lines} 条 · ${times}`;
}

function Groups({ groups, view }: { groups: readonly UsageGroup[]; view: UsageView }): ReactNode {
  const total = groups.reduce((sum, group) => sum + tokensOf(group.amount), 0);
  return (
    <ul className="usage-groups">
      {groups.map((group) => {
        const share = total === 0 ? 0 : tokensOf(group.amount) / total;
        return (
          <li key={group.key} className="usage-group">
            <span className="usage-group-text">
              <span className="usage-group-name">{group.name}</span>
              <span className="usage-group-sub">{groupSub(group, view)}</span>
            </span>
            <span className="usage-group-amount">
              <span>{tokenText(tokensOf(group.amount))} token</span>
              <span className="usage-group-cost">{costText(group.amount)}</span>
            </span>
            <span className="usage-group-share" aria-hidden="true"
              style={{ width: `${Math.max(share * 100, 0.6)}%` }} />
          </li>
        );
      })}
    </ul>
  );
}

function Body({ report }: { report: ModelUsageReport }): ReactNode {
  const [view, setView] = useState<UsageView>('model');
  if (report.total.requests === 0) {
    return <p className="block-empty">这段时间没有用过 AI。</p>;
  }
  const groups = view === 'model' ? report.byModel : report.byPurpose;
  return (
    <div className="usage-body">
      <Stats total={report.total} />
      <Chart buckets={report.buckets} range={report.range} timeZone={report.timeZone} />
      <div className="usage-split">
        <div className="segmented" role="group" aria-label="分开看">
          <button type="button" className="segmented-item" aria-pressed={view === 'model'}
            onClick={() => setView('model')}>按模型 {report.byModel.length}</button>
          <button type="button" className="segmented-item" aria-pressed={view === 'purpose'}
            onClick={() => setView('purpose')}>按用途 {report.byPurpose.length}</button>
        </div>
        <Groups groups={groups} view={view} />
      </div>
    </div>
  );
}

export function UsageSection(): ReactNode {
  const api = useApi();
  const timeZone = useTimeZone();
  const [range, setRange] = useState<UsageRange>('week');
  const [report, setReport] = useState<ModelUsageReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    api.modelUsage.report(range, timeZone, controller.signal).then(setReport, (cause: unknown) => {
      if (!controller.signal.aborted) setError(`没读到用量：${errorText(cause)}`);
    });
    return () => controller.abort();
  }, [api, range, timeZone, attempt]);
  return (
    <section className="block usage" aria-labelledby="settings-usage">
      <SectionHead id="settings-usage" title="用量">
        <div className="segmented usage-ranges" role="group" aria-label="时间范围">
          {USAGE_RANGES.map((item) => <button key={item} type="button" className="segmented-item"
            aria-pressed={range === item} onClick={() => setRange(item)}>{USAGE_RANGE_LABELS[item]}</button>)}
        </div>
      </SectionHead>
      {error !== null ? <p className="block-empty is-error" role="alert">{error}{' '}
        <button type="button" className="text-button" onClick={() => setAttempt((count) => count + 1)}>再读一次</button></p>
        : report === null ? <PageLoading rows={4} /> : <Body report={report} />}
    </section>
  );
}
