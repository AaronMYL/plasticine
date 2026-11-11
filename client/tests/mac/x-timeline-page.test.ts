// 读 X「关注」时间线的注入脚本（第 3 批）：在仿 X 结构的页面上认出没登录、切到「关注」、收帖子（作者、头像、正文、
// 第一张图、时间、链接），广告跳过、翻页重复的只算一条。

import { Value } from 'typebox/value';
import { describe, expect, it } from 'vitest';
import { XPostSchema } from '../../src/api/shared.ts';
import { chooseFollowing, collectPosts, fullText, readPost, timelineState,
  type XTimelinePost } from '../../src/mac/x-timeline-page.ts';

const BASE = 'https://x.com/home';

function tweet(options: { id: string; handle: string; name: string; text: string; photo?: string; ad?: boolean;
  more?: boolean }) {
  const time = options.ad === true ? '' : `<a href="/${options.handle}/status/${options.id}">`
    + `<time datetime="2026-11-04T06:58:00.000Z">1h</time></a>`;
  const photo = options.photo === undefined ? ''
    : `<div data-testid="tweetPhoto"><img src="${options.photo}" alt="Image"></div>`;
  return `<article data-testid="tweet">
    <div data-testid="Tweet-User-Avatar"><img src="https://pbs.twimg.com/profile_images/1/${options.handle}.jpg"></div>
    <div data-testid="User-Name"><a href="/${options.handle}"><span>${options.name}</span></a>
      <a href="/${options.handle}"><span>@${options.handle}</span></a>${time}</div>
    <div data-testid="tweetText"><span>${options.text}</span></div>${options.more === true
      ? `<a data-testid="tweet-text-show-more-link" href="/${options.handle}/status/${options.id}">Show more</a>` : ''}${photo}
  </article>`;
}

function page(body: string): Document {
  document.body.innerHTML = body;
  return document;
}

describe('X 时间线注入脚本', () => {
  it('没登录：登录页、登录按钮；登录了有主栏才算能读', () => {
    expect(timelineState(page('<div>x</div>'), 'https://x.com/i/flow/login')).toBe('signed_out');
    expect(timelineState(page('<a data-testid="loginButton">Log in</a>'), BASE)).toBe('signed_out');
    expect(timelineState(page('<div>载入中</div>'), BASE)).toBe('loading');
    expect(timelineState(page('<main data-testid="primaryColumn"></main>'), BASE)).toBe('ready');
  });

  it('切到「关注」：不在就点一下回 true，已经在回 false，找不到回 null', () => {
    const doc = page(`<div role="tablist"><div role="tab" aria-selected="true">For you</div>
      <div role="tab" aria-selected="false">Following</div></div>`);
    const following = doc.querySelectorAll('[role="tab"]')[1] as HTMLElement;
    let clicked = 0;
    following.addEventListener('click', () => {
      clicked += 1;
      following.setAttribute('aria-selected', 'true');
    });
    expect(chooseFollowing(doc)).toBe(true);
    expect(clicked).toBe(1);
    expect(chooseFollowing(doc)).toBe(false);
    expect(chooseFollowing(page('<div role="tablist"><div role="tab">Lists</div></div>'))).toBeNull();
  });

  it('一条帖子：作者、@账号、头像、正文（表情换成字）、第一张图、时间和数字标识', () => {
    const doc = page(tweet({ id: '1850000000000000001', handle: 'mayabuilds', name: 'Maya Chen',
      text: 'shipped <img alt="🚀" src="x.png"> 41 tasks', photo: 'https://pbs.twimg.com/media/abc?format=jpg' }));
    const post = readPost(doc.querySelector('article') as Element, BASE);
    expect(post).toEqual({
      id: '1850000000000000001', handle: 'mayabuilds', author: 'Maya Chen',
      avatar: 'https://pbs.twimg.com/profile_images/1/mayabuilds.jpg', text: 'shipped 🚀 41 tasks',
      image: 'https://pbs.twimg.com/media/abc?format=jpg', imageRatio: null,
      publishedAt: '2026-11-04T06:58:00.000Z',
    } satisfies XTimelinePost);
    expect(Value.Check(XPostSchema, post)).toBe(true);
  });

  it('收帖子：广告（没有时间链接）跳过；翻页又出现的同一条只算一次', () => {
    const seen = new Map<string, XTimelinePost>();
    const doc = page(tweet({ id: '1', handle: 'linjian_dev', name: '林间', text: '第一条' })
      + tweet({ id: '9', handle: 'brand', name: '广告', text: '买买买', ad: true }));
    expect(collectPosts(doc, BASE, seen)).toBe(1);
    page(tweet({ id: '1', handle: 'linjian_dev', name: '林间', text: '第一条' })
      + tweet({ id: '2', handle: 'linjian_dev', name: '林间', text: '第二条' }));
    expect(collectPosts(document, BASE, seen)).toBe(2);
    expect([...seen.values()].map((post) => post.text)).toEqual(['第一条', '第二条']);
  });

  it('长帖：时间线上只露一段的记下来；到帖子页上读这一条的全文，还只露一段时回 null', () => {
    const seen = new Map<string, XTimelinePost>();
    const truncated = new Set<string>();
    page(tweet({ id: '1', handle: 'linjian_dev', name: '林间', text: '短的' })
      + tweet({ id: '2', handle: 'linjian_dev', name: '林间', text: '长的前一段', more: true }));
    collectPosts(document, BASE, seen, truncated);
    expect([...truncated]).toEqual(['2']);
    const status = 'https://x.com/linjian_dev/status/2';
    page(tweet({ id: '2', handle: 'linjian_dev', name: '林间', text: '长的前一段', more: true }));
    expect(fullText(document, status, '2')).toBeNull();
    page(tweet({ id: '7', handle: 'other', name: '别人', text: '回复' })
      + tweet({ id: '2', handle: 'linjian_dev', name: '林间', text: '长的前一段，后面还有很多' }));
    expect(fullText(document, status, '2')).toBe('长的前一段，后面还有很多');
    expect(fullText(document, status, '3')).toBeNull();
  });
});
