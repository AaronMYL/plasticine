// video_parse 工具（《优化清单》第 9 条）：对话、后台线、定时线都能调。交一个链接，解析过的直接给结果，没解析过的排上
// 走一遍（预览 → 取地址 / 下载 → 字幕或本地转写 → 总结），默认等它做完。抖音要 Mac 取地址，Mac 不在线就回「排着」。

import type { AgentTool } from '@earendil-works/pi-agent-core';
import { VIDEO_PARSE_TOOL, VIDEO_STAGE_LABELS, VideoParseArgsSchema } from '../../shared/api/video.ts';
import { checkedArgs, type KernelTool } from '../lines/index.ts';
import { waitingTranscriber, type StateService, type VideoWorkRow } from '../state/index.ts';
import { videoTarget } from './links.ts';
import type { VideoWorker } from './worker.ts';

/** 工具里最多等这么久，再久就先回「在做」，下次调直接拿结果。 */
const TOOL_WAIT_MS = 25 * 60 * 1000;
/** 逐字稿回给模型最多这么多字（长了用 read_result 翻）。 */
const TRANSCRIPT_IN_REPLY_MAX = 12_000;

export type VideoToolState = Pick<StateService, 'videoWorks'>;

function list(title: string, items: readonly string[]): string[] {
  return items.length === 0 ? [] : [title, ...items.map((item) => `- ${item}`)];
}

/** 给模型看的结果。 */
export function resultText(work: VideoWorkRow): string {
  if (work.run === 'waiting_mac') {
    return `「${work.title}」排着：要他电脑上的抖音登录状态取下载地址，电脑上线后自动接着做。不用再调。`;
  }
  if (waitingTranscriber(work)) {
    return `「${work.title}」要先装本地转写才能解析：请他到「设置 › AI」的「本地转写」那一行点「安装」`
      + '（只装一次，装在 Plasticine 所在的机器上），装好自动接着解析。不用再调。';
  }
  if (work.run === 'failed') {
    return `「${work.title}」没解析成：${work.error ?? '原因没记下'}`;
  }
  if (work.stage !== 'summarized' || work.digest === null) {
    return `「${work.title}」在解析（${VIDEO_STAGE_LABELS[work.stage]}），过一会儿再调 video_parse 拿结果。`;
  }
  const transcript = work.transcript ?? '';
  const cut = Array.from(transcript);
  const sourceLabel = { caption: '配文', subtitle: '自带字幕', local: '本地转写', images: '图片文字' };
  return [
    `标题：${work.title}${work.author === null ? '' : `（${work.author}）`}`,
    `链接：${work.url}`,
    `概要：${work.digest.summary}`,
    ...list('大纲：', work.digest.outline),
    ...list('核心观点：', work.digest.points),
    ...list('和他有关：', work.digest.related),
    `逐字稿（${work.transcriptSource === null ? '未知来源' : sourceLabel[work.transcriptSource]}）：`,
    cut.length > TRANSCRIPT_IN_REPLY_MAX ? `${cut.slice(0, TRANSCRIPT_IN_REPLY_MAX).join('')}…（后面还有）` : transcript,
  ].join('\n');
}

function createTool(state: VideoToolState, worker: VideoWorker): AgentTool<typeof VideoParseArgsSchema> {
  return {
    name: VIDEO_PARSE_TOOL,
    label: '视频解析',
    description: 'Parses any video or image-post link (Douyin, Bilibili, YouTube, direct mp4 …) on this machine: '
      + 'transcript (built-in subtitles first, otherwise local speech-to-text), outline, key points and what '
      + 'relates to his interests. Works already parsed return at once. Douyin needs his Mac online to get the '
      + 'download address; if it is offline the work waits. Takes minutes: from the main line, run it in a '
      + 'background line.',
    parameters: VideoParseArgsSchema,
    async execute(_toolCallId, raw, signal) {
      const args = checkedArgs(VideoParseArgsSchema, raw, VIDEO_PARSE_TOOL);
      const outer = signal ?? new AbortController().signal;
      const target = await videoTarget(args.url, outer);
      const { work } = state.videoWorks.upsert({ platform: target.platform, workId: target.workId, url: target.url,
        title: target.platform === 'douyin' ? `抖音作品 ${target.workId}` : target.url, kind: target.kind });
      state.videoWorks.want([work.id]);
      worker.kick();
      const current = state.videoWorks.require(work.id);
      if (args.wait === false || current.stage === 'summarized') {
        return { content: [{ type: 'text', text: resultText(current) }], details: { workId: work.id } };
      }
      const wait = AbortSignal.any([outer, AbortSignal.timeout(TOOL_WAIT_MS)]);
      let done: VideoWorkRow;
      try {
        done = await worker.waitFor(work.id, wait);
      } catch (cause) {
        if (outer.aborted) {
          throw cause;
        }
        done = state.videoWorks.require(work.id);
      }
      return { content: [{ type: 'text', text: resultText(done) }], details: { workId: work.id } };
    },
  };
}

export function videoParseTool(state: VideoToolState, worker: VideoWorker): KernelTool {
  return {
    name: VIDEO_PARSE_TOOL,
    say: (args) => (typeof args['url'] === 'string' ? `解析视频：${args['url']}` : '解析视频'),
    hardLine: () => null,
    create: () => createTool(state, worker),
  };
}
