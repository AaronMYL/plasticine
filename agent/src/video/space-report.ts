// 视频总结和资料库共用同一份空间；旧总结只补版式，不再下载或转写。
import { renderVideoPage, VIDEO_TITLE_MAX, videoTitle } from '../../shared/video-space-page.ts';
import type { Space } from '../../shared/state.ts';
import type { StateService, VideoWorkRow } from '../state/index.ts';
import { writeSpace } from '../subs/index.ts';

export type VideoSpaceState = Pick<StateService,
  'spaces' | 'subscriptions' | 'transaction' | 'videoWorks' | 'dailySettings'>;

export function publishVideoSpace(state: VideoSpaceState, work: VideoWorkRow): Space | null {
  if (work.digest === null) throw new Error('这条作品还没有总结，不能生成报告。');
  return state.transaction(() => {
    const linked = work.spaceId === null ? undefined : state.spaces.get(work.spaceId);
    if (work.spaceId !== null && linked === undefined) return null;
    const existing = linked ?? state.spaces.findBySourceUrl(work.url, 'report');
    if (existing?.deletedAt !== undefined && existing.deletedAt !== null) return existing;
    const title = videoTitle(work);
    const { space } = writeSpace(state, { title, genre: 'report', category: 'report', sourceUrl: work.url,
      html: renderVideoPage({ ...work, digest: work.digest! },
        state.dailySettings.read().settings.timeZone ?? 'Asia/Shanghai'),
      ...(existing === undefined ? {} : { id: existing.id, version: existing.version }) }, 'ai');
    if (work.spaceId !== space.id) state.videoWorks.advance(work.id, { spaceId: space.id });
    return space;
  });
}

/**
 * 旧报告的标题是整段总结（11-12 Aaron 同意改成短标题）：标题比 40 字长的视频报告按现在的规则重出一遍
 * （只换标题和页头，不重新下载、转写）。他自己改过的短标题不动；删掉的不动。
 */
function retitleLongVideoSpaces(state: VideoSpaceState): number {
  let changed = 0;
  for (const work of state.videoWorks.withSpace(200)) {
    const space = work.spaceId === null ? undefined : state.spaces.get(work.spaceId);
    if (work.digest !== null && space !== undefined && space.deletedAt === null
      && Array.from(space.title).length > VIDEO_TITLE_MAX) {
      publishVideoSpace(state, work);
      changed += 1;
    }
  }
  return changed;
}

export function backfillVideoSpaces(state: VideoSpaceState): number {
  const works = state.videoWorks.withoutSpace(20);
  for (const work of works) publishVideoSpace(state, work);
  return works.length + retitleLongVideoSpaces(state);
}
