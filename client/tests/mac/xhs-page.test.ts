// 小红书的取数脚本（第13批）：在仿小红书结构的页面上认出要验证、没登录、能读了；从初始数据（Vue ref 包着的）读首页推荐和
// 主页的收藏那一页，再从页面上看得见的笔记卡片补上往下翻出来的；广告跳过、同一条只算一次；主页切到「收藏」。

import { Value } from 'typebox/value';
import { describe, expect, it } from 'vitest';
import { XhsNoteSchema } from '../../src/api/shared.ts';
import { cardNote, chooseSaved, collectNotes, exploreNotes, myId, pageState, savedNotes, unwrap,
  type XhsListedNote } from '../../src/mac/xhs-page.ts';

const EXPLORE = 'https://www.xiaohongshu.com/explore';
const ME = '5f0a1b2c3d4e5f6a7b8c9d0e';
const PROFILE = `https://www.xiaohongshu.com/user/profile/${ME}?tab=fav&subTab=note`;
const A = '6614a2b3000000001a0123ab';
const B = '6614a2b3000000001a0123cd';
const C = '6614a2b3000000001a0123ef';

function ref<T>(value: T): { __v_isRef: true; _rawValue: T; _value: T } {
  return { __v_isRef: true, _rawValue: value, _value: value };
}

function feedItem(id: string, title: string, type = 'normal', modelType = 'note'): Record<string, unknown> {
  return { id, modelType, xsecToken: 'AB123=', noteCard: { type, displayTitle: title,
    user: { userId: '5e0000000000000000000001', nickname: '收纳小周', avatar: 'https://sns-avatar-qc.xhscdn.com/a.jpg' },
    cover: { urlDefault: 'https://sns-webpic-qc.xhscdn.com/c.webp', width: 1080, height: 1440 } } };
}

function card(id: string, title: string, options: { hidden?: boolean; video?: boolean } = {}): string {
  return `<div${options.hidden === true ? ' style="display: none"' : ''}>
    <section class="note-item" data-width="1080" data-height="1350"><div>
      <a href="/explore/${id}" style="display:none"></a>
      <a class="cover mask" href="/search_result/${id}?xsec_token=AB&xsec_source=">
        <img src="https://sns-webpic-qc.xhscdn.com/${id}.webp">${options.video === true
          ? '<span class="play-icon"></span>' : ''}
      </a>
      <div class="footer"><a class="title"><span>${title}</span></a>
        <div class="card-bottom-wrapper"><a class="author" href="/user/profile/5e0000000000000000000002">
          <img class="author-avatar" src="https://sns-avatar-qc.xhscdn.com/b.jpg"><span class="name">厨房小记</span></a>
        </div></div>
    </div></section></div>`;
}

function page(body: string): Document {
  document.body.innerHTML = body;
  return document;
}

describe('小红书取数脚本', () => {
  it('拆 Vue ref：_rawValue / _value；原样的值照返', () => {
    expect(unwrap(ref([1, 2]))).toEqual([1, 2]);
    expect(unwrap({ _value: 'x' })).toBe('x');
    expect(unwrap([3])).toEqual([3]);
  });

  it('页面状态：验证页、登录框或初始数据说没登录、有笔记才算能读', () => {
    expect(pageState(page(''), 'https://www.xiaohongshu.com/website-login/captcha?verifyUuid=1', {})).toBe('verify');
    expect(pageState(page(''), EXPLORE, { user: { loggedIn: ref(false) } })).toBe('signed_out');
    expect(pageState(page('<div class="login-container"></div>'), EXPLORE, {})).toBe('signed_out');
    expect(pageState(page(''), EXPLORE, { user: { loggedIn: ref(true) } })).toBe('loading');
    expect(pageState(page(card(A, '一篇')), EXPLORE, { user: { loggedIn: true } })).toBe('ready');
    expect(pageState(page(''), EXPLORE, { feed: { feeds: ref([feedItem(A, '一篇')]) } })).toBe('ready');
  });

  it('首页初始数据：推荐笔记的标题、作者、头像、封面和比例、是不是视频；不是笔记的（广告）跳过', () => {
    const notes = exploreNotes({ feed: { feeds: ref([feedItem(A, '桌面整理'), feedItem(B, '骑行', 'video'),
      feedItem(C, '广告', 'normal', 'ad')]) } });
    expect(notes).toEqual([
      { id: A, title: '桌面整理', author: '收纳小周', avatar: 'https://sns-avatar-qc.xhscdn.com/a.jpg',
        image: 'https://sns-webpic-qc.xhscdn.com/c.webp', imageRatio: 1.333, video: false },
      expect.objectContaining({ id: B, video: true }),
    ]);
    for (const note of notes) {
      expect(Value.Check(XhsNoteSchema, { ...note, places: ['recommend'] })).toBe(true);
    }
  });

  it('主页初始数据：只取收藏那一页（笔记、收藏、赞过排第二），认出自己的标识', () => {
    const state = { user: { userInfo: ref({ userId: ME, nickname: '我' }),
      notes: ref([[feedItem(A, '我发的')], [{ noteCard: { noteId: B, displayTitle: '收藏的', type: 'normal',
        user: { nickName: '别人' }, cover: { url: 'https://sns-webpic-qc.xhscdn.com/d.webp' } } }], []]) } };
    expect(savedNotes(state).map((note) => [note.id, note.title, note.author])).toEqual([[B, '收藏的', '别人']]);
    expect(myId(state)).toBe(ME);
    expect(myId({ user: { userInfo: ref({}) } })).toBeNull();
  });

  it('页面上的卡片：从链接认出笔记标识，标题、作者、封面、视频标；藏着的那一页不收；和初始数据合起来去重', () => {
    const doc = page(card(A, '和初始数据重复的') + card(B, '翻出来的', { video: true }) + card(C, '没切到的那一页',
      { hidden: true }));
    expect(cardNote(doc.querySelectorAll('section.note-item')[1]!, EXPLORE)).toEqual({ id: B, title: '翻出来的',
      author: '厨房小记', avatar: 'https://sns-avatar-qc.xhscdn.com/b.jpg',
      image: `https://sns-webpic-qc.xhscdn.com/${B}.webp`, imageRatio: 1.25, video: true });
    const seen = new Map<string, XhsListedNote>();
    expect(collectNotes(doc, EXPLORE, { feed: { feeds: ref([feedItem(A, '桌面整理')]) } }, seen)).toBe(2);
    expect([...seen.values()].map((note) => note.title)).toEqual(['桌面整理', '翻出来的']);
    // 主页上读的是收藏那一页，不把首页的推荐当收藏。
    const saved = new Map<string, XhsListedNote>();
    collectNotes(page(''), PROFILE, { feed: { feeds: ref([feedItem(A, '推荐的')]) } }, saved);
    expect(saved.size).toBe(0);
  });

  it('主页切到「收藏」：不在就点一下回 true，已经在回 false，找不到回 null', () => {
    const doc = page(`<div class="reds-tab-item active">笔记</div><div class="reds-tab-item">收藏</div>`);
    const saved = doc.querySelectorAll('.reds-tab-item')[1] as HTMLElement;
    saved.addEventListener('click', () => saved.classList.add('active'));
    expect(chooseSaved(doc)).toBe(true);
    expect(chooseSaved(doc)).toBe(false);
    expect(chooseSaved(page('<div class="reds-tab-item">笔记</div>'))).toBeNull();
  });
});
