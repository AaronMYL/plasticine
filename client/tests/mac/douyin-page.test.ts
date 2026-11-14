// 抖音收藏的取数脚本（第 6 批第 9 条）：按 TikTokDownloader 认的字段读收藏夹、收藏作品和作品详情；结果按服务端的 schema
// 核对；翻到上次同步过的就停；没登录、作品没了分别报出来。

import { Value } from 'typebox/value';
import { describe, expect, it } from 'vitest';
import { DouyinListedWorkSchema, DouyinResolvedSchema } from '../../src/api/shared.ts';
import { folderOf, listedWork, listFavorites, resolvedWork, resolveWork, type DouyinCall }
  from '../../src/mac/douyin-page.ts';

const AWEME = {
  aweme_id: '7300000000000000001', aweme_type: 0, desc: '普通人做指数定投的三个误区 #理财 #定投',
  create_time: 1_762_400_000, collect_time: 1_762_416_000, author: { nickname: '理财小课堂' },
  video: { duration: 222_000, play_addr: { url_list: ['http://v26-web.douyinvod.com/low.mp4'] },
    bit_rate: [{ bit_rate: 500, play_addr: { url_list: ['https://v3.douyinvod.com/500.mp4'] } },
      { bit_rate: 1800, play_addr: { url_list: ['https://v3.douyinvod.com/1800.mp4'] } }] },
};
const NOTE = { aweme_id: '7300000000000000002', aweme_type: 68, desc: '一口气看懂睡眠周期', author: { nickname: '科普君' },
  images: [{ url_list: ['https://p3.douyinpic.com/1.jpeg'] }, { url_list: ['https://p3.douyinpic.com/2.jpeg'] }] };

describe('抖音收藏的取数脚本', () => {
  it('收藏列表的一条：标题、作者、收藏时间、时长；图文认成 images；认不出 ID 的不要', () => {
    const work = listedWork(AWEME, 'f1');
    expect(Value.Check(DouyinListedWorkSchema, work)).toBe(true);
    expect(work).toMatchObject({ title: '普通人做指数定投的三个误区', author: '理财小课堂', kind: 'video',
      durationSeconds: 222, collectedAt: new Date(1_762_416_000 * 1000).toISOString(), folderIds: ['f1'] });
    expect(listedWork(NOTE, null)?.kind).toBe('images');
    expect(listedWork({ aweme_id: '../1' }, null)).toBeNull();
    expect(folderOf({ collects_id_str: '123', collects_name: '学习', total_number: 12 }))
      .toEqual({ id: '123', name: '学习', count: 12 });
  });

  it('收藏时间缺失时保持空，发布时间单独保留', () => {
    const work = listedWork({ ...AWEME, collect_time: undefined }, null, 7);
    expect(work?.collectedAt).toBeNull();
    expect(work?.publishedAt).toBe(new Date(AWEME.create_time * 1000).toISOString());
    expect(work?.listPosition).toBe(7);
  });

  it('全量回填忽略已知作品，超过旧的 50 页限制仍取到末页并带全局位置', async () => {
    const call: DouyinCall = async (path, params) => {
      if (path.includes('collects/list')) { return { collects_list: [] }; }
      const page = Number(params['cursor']);
      return { aweme_list: [{ ...AWEME, aweme_id: String(7300000000000000001n + BigInt(page)) }],
        has_more: page < 60 ? 1 : 0, cursor: String(page + 1) };
    };
    const result = await listFavorites(call, [AWEME.aweme_id], true);
    expect(result.works).toHaveLength(61);
    expect(result.works.map((work) => work.listPosition)).toEqual(Array.from({ length: 61 }, (_, i) => i));
  });

  it('作品详情：取最高码率的无水印地址；图文取每张图；格式过 schema', () => {
    const video = resolvedWork({ aweme_detail: AWEME });
    expect(Value.Check(DouyinResolvedSchema, video)).toBe(true);
    expect(video?.videoUrl).toBe('https://v3.douyinvod.com/1800.mp4');
    const note = resolvedWork({ aweme_detail: NOTE });
    expect(note?.videoUrl).toBeNull();
    expect(note?.images).toEqual(['https://p3.douyinpic.com/1.jpeg', 'https://p3.douyinpic.com/2.jpeg']);
  });

  it('翻收藏：先收藏夹，再按收藏翻页，翻到上次同步过的就停；同一条在收藏夹里也在总收藏里只算一条', async () => {
    const calls: string[] = [];
    const older = { ...AWEME, aweme_id: '7300000000000000009' };
    const call: DouyinCall = async (path, params) => {
      calls.push(`${path}?${params['cursor'] ?? ''}`);
      if (path.includes('collects/list')) {
        return { status_code: 0, collects_list: [{ collects_id_str: '55', collects_name: '理财', total_number: 1 }] };
      }
      if (path.includes('listcollection')) {
        return params['cursor'] === '0'
          ? { status_code: 0, aweme_list: [AWEME, NOTE], has_more: 1, cursor: '2' }
          : { status_code: 0, aweme_list: [older, { ...AWEME, aweme_id: '7300000000000000010' }], has_more: 1, cursor: '4' };
      }
      return { status_code: 0, aweme_list: [AWEME], has_more: 0 };
    };
    const result = await listFavorites(call, ['7300000000000000009']);
    expect(result.works.map((work) => work.workId)).toEqual(['7300000000000000001', '7300000000000000002']);
    expect(result.works[0]?.folderIds).toEqual(['55']);
    expect(calls.filter((entry) => entry.includes('listcollection'))).toHaveLength(2);
  });

  it('翻到空页不当翻完：抖音说还有就接着翻，一直翻到「没有更多」', async () => {
    const call: DouyinCall = async (path, params) => {
      if (path.includes('collects/list')) { return { collects_list: [] }; }
      const page = Number(params['cursor']);
      // 失效（删了、设私密）的作品抖音还算在条数里，那几页回来是空的。
      const list = page >= 1 && page <= 3 ? [] : [{ ...AWEME, aweme_id: String(7300000000000000001n + BigInt(page)) }];
      return { aweme_list: list, has_more: page < 5 ? 1 : 0, cursor: String(page + 1) };
    };
    const result = await listFavorites(call, []);
    expect(result.works.map((work) => work.workId)).toEqual(['7300000000000000001', '7300000000000000005',
      '7300000000000000006']);
  });

  it('收藏夹多过一页也翻完', async () => {
    const call: DouyinCall = async (path, params) => {
      if (path.includes('collects/list')) {
        return params['cursor'] === '0'
          ? { collects_list: [{ collects_id_str: '1', collects_name: '学习' }], has_more: 1, cursor: '1' }
          : { collects_list: [{ collects_id_str: '2', collects_name: '做饭' }], has_more: 0, cursor: '2' };
      }
      return { aweme_list: [], has_more: 0 };
    };
    expect((await listFavorites(call, [])).folders.map((folder) => folder.name)).toEqual(['学习', '做饭']);
  });

  it('没登录、作品没了分别报出来', async () => {
    await expect(listFavorites(async () => ({ status_code: 8 }), [])).rejects.toThrow('signed_out');
    await expect(resolveWork(async () => ({ status_code: 0, aweme_detail: null }), '7300000000000000001'))
      .rejects.toThrow('not_found');
  });
});
