import { escapeHtmlAttribute as attr, escapeHtmlText as text } from './space-html.ts';
import type { VideoDigest, VideoWorkView } from './api/video.ts';

export type VideoPageWork = Pick<VideoWorkView, 'platform' | 'title' | 'author' | 'durationSeconds' | 'collectedAt'>
  & { digest: VideoDigest; transcript: string | null; collectSeq: number | null };

const CSS = `.vr{max-width:960px;margin:auto;padding:32px 32px 64px;font-size:14px;line-height:1.65}
.vr h1{font-size:28px;line-height:1.4;font-weight:600;margin:12px 0 24px}
.vr-meta{display:flex;gap:12px;flex-wrap:wrap;color:var(--fg2);font-size:12px}
.vr-meta b{color:var(--fg);font-weight:500}.vr-frames{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
.vr-frames figure{margin:0}.vr-frames img{width:100%;aspect-ratio:16/10;object-fit:cover;border-radius:8px}
.vr-frames figcaption{font:12px var(--mono);color:var(--fg2)}
.vr-cols{display:grid;grid-template-columns:1fr 1fr;gap:32px;margin-top:32px}.vr h2{font-size:16px;font-weight:600}
.vr-list{list-style:none;padding:0;margin:12px 0}.vr-list li{display:flex;gap:12px;padding:12px 0;
border-bottom:1px solid var(--line)}.vr a{color:var(--hue-sky)}.vr-time{font-family:var(--mono);white-space:nowrap}
.vr-num{font:24px var(--mono);color:var(--hue-rose)}.vr-related{border-left:1px solid var(--fg3);padding-left:12px;
margin-top:24px}.vr-transcript{margin-top:24px}.vr-transcript summary{cursor:pointer;color:var(--fg2)}
.vr-transcript p{white-space:pre-wrap;scroll-margin-top:24px}.vr-transcript time{color:var(--fg3);margin-right:12px}
@media(max-width:600px){.vr{padding:24px 16px 48px}.vr h1{font-size:24px}.vr-cols{grid-template-columns:1fr;gap:16px}
.vr-frames{grid-template-columns:repeat(2,1fr)}}`;

export function outlineTime(line: string): { seconds: number; label: string; content: string } | null {
  const found = /^\s*\[?(?:(\d+):)?(\d{1,2}):(\d{2})\]?\s*(.*)$/.exec(line);
  if (found === null) return null;
  const seconds = Number(found[1] ?? 0) * 3600 + Number(found[2]) * 60 + Number(found[3]);
  const label = [found[1], found[2]?.padStart(2, '0'), found[3]].filter((part) => part !== undefined).join(':');
  return { seconds, label, content: found[4] ?? '' };
}

function duration(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}

export function renderVideoPage(work: VideoPageWork, timeZone = 'Asia/Shanghai'): string {
  const digest = work.digest!;
  const lines = (work.transcript ?? '').split('\n').filter((line) => line.trim() !== '');
  const positions = lines.map((line, index) => ({ ...outlineTime(line), index }));
  const destination = (seconds: number): string => {
    const before = positions.filter((line) => line.seconds !== undefined && line.seconds <= seconds).at(-1);
    return `transcript-${before?.index ?? 0}`;
  };
  const jump = (seconds: number, content: string, className = ''): string =>
    `<a class="${className}" href="#${destination(seconds)}" data-seconds="${seconds}"`
    + ` onclick="document.querySelector('.vr-transcript').open=true">${content}</a>`;
  const metadata = [work.author === null ? '' : text(work.author),
    work.durationSeconds === null ? '' : duration(work.durationSeconds),
    work.collectSeq === null || work.collectedAt === null ? '' : `收藏于 ${new Intl.DateTimeFormat('zh-CN',
      { timeZone, year: 'numeric', month: '2-digit',
      day: '2-digit' }).format(new Date(work.collectedAt))}`]
    .filter(Boolean).map((value) => `<span>${value}</span>`).join('');
  const frames = (digest.images ?? []).map((image, index) => {
    const picture = `<img src="/v2/notes/assets/${attr(image.asset)}" alt="${image.seconds === null
      ? `原图 ${index + 1}` : `${duration(image.seconds)} 关键帧`}" loading="lazy">`;
    return `<figure>${image.seconds === null ? picture : jump(image.seconds, picture)}<figcaption>`
      + `${image.seconds === null ? `原图 ${index + 1}` : duration(image.seconds)}</figcaption></figure>`;
  }).join('');
  const outline = digest.outline.map((line) => {
    const time = outlineTime(line);
    return `<li>${time === null ? text(line)
      : `${jump(time.seconds, time.label, 'vr-time')}<span>${text(time.content)}</span>`}</li>`;
  }).join('');
  const points = digest.points.map((point, index) => `<li><span class="vr-num">${index + 1}</span>`
    + `<span>${text(point)}</span></li>`).join('');
  const related = digest.related.length === 0 ? '' : `<div class="vr-related">${digest.related
    .map((point) => `<p>✦ ${text(point)}</p>`).join('')}</div>`;
  const transcript = lines.map((line, index) => {
    const time = outlineTime(line);
    return `<p id="transcript-${index}">${time === null ? text(line)
      : `<time>${text(time.label)}</time>${text(time.content)}`}</p>`;
  }).join('');
  return `<style>${CSS}</style><article class="vr"><header><div class="vr-meta"><b>`
    + `${work.platform === 'douyin' ? '抖音收藏' : '视频总结'}</b>${metadata}</div><h1>${text(digest.summary
      || work.title)}</h1></header>${frames === '' ? '' : `<div class="vr-frames">${frames}</div>`}`
    + `<div class="vr-cols"><section><h2>大纲</h2><ol class="vr-list">${outline}</ol></section>`
    + `<section><h2>核心观点</h2><ol class="vr-list">${points}</ol>${related}</section></div>`
    + `<details class="vr-transcript"><summary>逐字稿 `
    + `${(work.transcript ?? '').length.toLocaleString('zh-CN')} 字`
    + `</summary>${transcript}</details></article>`;
}
