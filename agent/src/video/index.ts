// video/：视频解析与抖音收藏（《优化清单》第 9 条）。一个通用技能：任何视频链接都能交给它（对话、后台线、定时线用
// video_parse 工具；抖音收藏由他在信息流的来源管理里勾选）。下载、抽音频、转写都在本体所在的机器上做；抖音的下载地址
// 由他 Mac 上的登录状态取。外面只经这里。

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { TextModels } from '../kernel/index.ts';
import type { StateService, VideoWorkRow } from '../state/index.ts';
import { safeLog } from '../shared-log.ts';
import { createVideoDigester } from './digest.ts';
import { DouyinFavorites } from './douyin.ts';
import type { TranscriberStatus } from '../../shared/api/video.ts';
import { kitPlan, type KitPlan } from './kit-files.ts';
import { TranscribeKit, type KitPorts } from './kit.ts';
import { downloadTo, extractAudio, extractFrame, fetchImage, fetchText, fetchWebVideo, readFileText } from './media.ts';
import type { VideoMedia } from './pipeline.ts';
import { seedVideoSkill, skillPrompt } from './skill.ts';
import { videoParseTool } from './tool.ts';
import type { Transcriber } from './transcriber.ts';
import { VideoWorker } from './worker.ts';
import { backfillVideoSpaces, publishVideoSpace } from './space-report.ts';

export { DOUYIN_ERROR_TEXT, DouyinFavorites, MAC_JOB_STALE_MS, videoWorkView, workUrl } from './douyin.ts';
export { DOUYIN_SOURCE, publishToFeed } from './feed-publish.ts';
export { createVideoDigester, DEFAULT_PROMPTS } from './digest.ts';
export type { VideoDigester, VideoPromptName } from './digest.ts';
export { douyinTarget, videoTarget, webTarget } from './links.ts';
export { advanceWork } from './pipeline.ts';
export { KIT_VERSION, kitBytes, kitPlan } from './kit-files.ts';
export type { KitFile, KitPlan } from './kit-files.ts';
export { kitFailure, REAL_KIT_PORTS, TranscribeKit } from './kit.ts';
export type { KitPorts } from './kit.ts';
export { SherpaTranscriber, sherpaFailure, sherpaLines } from './sherpa.ts';
export { silentWav, wavHeaderSeconds } from './wav.ts';
export type { PipelinePorts, VideoMedia } from './pipeline.ts';
export { seedVideoSkill, skillPrompt, VIDEO_SKILL_NAME, videoSkillDirectory } from './skill.ts';
export { parseSubtitle, transcriptText } from './subtitles.ts';
export { CommandTranscriber, resultOf, transcriberFromEnv, TRANSCRIBE_ENGINES } from './transcriber.ts';
export type { Transcriber, TranscribeResult } from './transcriber.ts';
export { resultText, videoParseTool } from './tool.ts';
export { limiter, TRANSCRIBE_AT_ONCE, VIDEO_RUNS_MAX, VideoWorker } from './worker.ts';

/** 真的下载、抽音频、截图；ffmpeg 是要跑的那一份（装好的组件里的，没有就用系统里的）。 */
export function realMedia(ffmpeg: () => string): VideoMedia {
  return {
    download: (url, file, signal) => downloadTo(url, file, signal),
    extractAudio: (input, output, signal) => extractAudio(input, output, signal, ffmpeg()),
    extractFrame: (input, seconds, signal) => extractFrame(input, seconds, signal, ffmpeg()),
    fetchText,
    fetchImage,
    readText: readFileText,
    webVideo: fetchWebVideo,
  };
}

export interface VideoOptions {
  state: StateService;
  now: () => Date;
  stateDirectory: string;
  text: TextModels;
  /** 环境变量配的转写（优先于装的组件）；测试给假的。 */
  transcriber: Transcriber | null;
  /** 本地转写组件：要下哪几样（默认按这台机器的系统）、怎么下和解开（测试给假的）。 */
  kit?: { plan?: KitPlan | null; ports?: Partial<KitPorts> };
  media?: VideoMedia;
  /** 还能开几条（后台线并发上限减去在跑的后台线）。 */
  slots: () => number;
  /** 他关心的方向（信息流的关注点），总结时写「和你有关」。 */
  interests: () => string[];
  summarized?: (work: VideoWorkRow) => void;
  changed?: () => void;
  /** 本地转写装的进度和结果。 */
  transcriberChanged?: (status: TranscriberStatus) => void;
}

export function createVideo(options: VideoOptions) {
  try {
    seedVideoSkill(options.stateDirectory);
  } catch (cause) {
    safeLog('error', 'video_skill_seed_failed', { error: cause });
  }
  const tempRoot = join(options.stateDirectory, 'video-work');
  mkdirSync(tempRoot, { recursive: true, mode: 0o700 });
  const changed = options.changed ?? (() => undefined);
  const backfill = (): void => { if (backfillVideoSpaces(options.state) > 0) changed(); };
  let resume = (): void => undefined;
  const kit = new TranscribeKit({ directory: join(options.stateDirectory, 'components'),
    plan: options.kit?.plan === undefined ? kitPlan(process.platform, process.arch) : options.kit.plan,
    env: options.transcriber, ...(options.kit?.ports === undefined ? {} : { ports: options.kit.ports }),
    changed: (status) => {
      options.transcriberChanged?.(status);
      if (status.state === 'ready') resume();
    } });
  const worker = new VideoWorker({
    state: options.state,
    slots: options.slots,
    ports: {
      media: options.media ?? realMedia(() => kit.ffmpeg()),
      saveImage: (image) => options.state.notes.writeAsset(Buffer.from(image.data, 'base64'), image.mimeType).name,
      publish: (work) => { publishVideoSpace(options.state, work); },
      digester: createVideoDigester(options.text, skillPrompt(options.stateDirectory)),
      transcriber: () => kit.transcriber(),
      interests: options.interests,
      tempRoot,
      now: () => options.now().getTime(),
    },
    changed: () => changed(),
    ...(options.summarized === undefined ? {} : { summarized: options.summarized }),
  });
  resume = () => { if (worker.resumeTranscribing() > 0) changed(); };
  const douyin = new DouyinFavorites({ state: options.state, worker, now: options.now, changed });
  return {
    worker,
    douyin,
    kit,
    tool: videoParseTool(options.state, worker),
    start: () => {
      backfill();
      worker.start();
      if (kit.transcriber() !== null) resume();
    },
    stop: async () => { await kit.stop(); await worker.stop(); },
    scans: [{ name: '视频解析', run: () => { backfill(); worker.kick(); } }],
  };
}

export type Video = ReturnType<typeof createVideo>;
