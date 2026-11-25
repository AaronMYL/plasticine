import { Value } from 'typebox/value';
import { describe, expect, it } from 'vitest';
import { XPostSchema } from '../../src/api/shared.ts';
import { chooseFollowing, chooseRecommend, collectPosts, fullText, readPost, timelineState,
  type XTimelinePost } from '../../src/mac/x-timeline-page.ts';

const BASE = 'https://x.com/home';

function tweet(options: { id: string; handle: string; name: string; text: string; photo?: string; ad?: boolean;
  more?: boolean; photos?: string[] }) {
  const time = options.ad === true ? '' : `<a href="/${options.handle}/status/${options.id}">`
    + `<time datetime="2026-11-04T06:58:00.000Z">1h</time></a>`;
  const photo = [...(options.photo === undefined ? [] : [options.photo]), ...(options.photos ?? [])]
    .map((src) => `<div data-testid="tweetPhoto"><img src="${src}" alt="Image"></div>`).join('');
  return `<article data-testid="tweet">
    <div data-testid="Tweet-User-Avatar"><img src="https://pbs.twimg.com/profile_images/1/${options.handle}.jpg"></div>
    <div data-testid="User-Name"><a href="/${options.handle}"><span>${options.name}</span></a>
      <a href="/${options.handle}"><span>@${options.handle}</span></a>${time}</div>
    <div data-testid="tweetText"><span>${options.text}</span></div>${options.more === true
      ? `<a data-testid="tweet-text-show-more-link" href="/${options.handle}/status/${options.id}">Show more</a>`
      : ''}${photo}
  </article>`;
}

function page(body: string): Document {
  document.body.innerHTML = body;
  return document;
}

describe('X timeline injection script', () => {
  it('detects logged-out page or login button; readable only when logged in with primary column', () => {
    expect(timelineState(page('<div>x</div>'), 'https://x.com/i/flow/login')).toBe('signed_out');
    expect(timelineState(page('<a data-testid="loginButton">Log in</a>'), BASE)).toBe('signed_out');
    expect(timelineState(page('<div>载入中</div>'), BASE)).toBe('loading');
    expect(timelineState(page('<main data-testid="primaryColumn"></main>'), BASE)).toBe('ready');
  });

  it('switch to Following clicks and returns true, false if active, null if missing', () => {
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

  it('switch to For You matches zh/en labels: clicks returning true, false if active, else null', () => {
    const doc = page(`<div role="tablist"><div role="tab" aria-selected="false">为你推荐</div>
      <div role="tab" aria-selected="true">正在关注</div></div>`);
    const recommend = doc.querySelectorAll('[role="tab"]')[0] as HTMLElement;
    recommend.addEventListener('click', () => recommend.setAttribute('aria-selected', 'true'));
    expect(chooseRecommend(doc)).toBe(true);
    expect(chooseRecommend(doc)).toBe(false);
    expect(chooseRecommend(page('<div role="tablist"><div role="tab" aria-selected="true">For you</div></div>')))
      .toBe(false);
    expect(chooseRecommend(page('<div role="tablist"><div role="tab">Lists</div></div>'))).toBeNull();
  });

  it('bookmarks page (/i/bookmarks) counts as readable when logged in', () => {
    expect(timelineState(page('<main data-testid="primaryColumn"></main>'), 'https://x.com/i/bookmarks'))
      .toBe('ready');
  });

  it('parses post author, handle, avatar, text with emoji alt, first image, time, and numeric ID', () => {
    const doc = page(tweet({ id: '1850000000000000001', handle: 'mayabuilds', name: 'Maya Chen',
      text: 'shipped <img alt="🚀" src="x.png"> 41 tasks', photo: 'https://pbs.twimg.com/media/abc?format=jpg' }));
    const post = readPost(doc.querySelector('article') as Element, BASE);
    expect(post).toEqual({
      id: '1850000000000000001', handle: 'mayabuilds', author: 'Maya Chen',
      avatar: 'https://pbs.twimg.com/profile_images/1/mayabuilds.jpg', text: 'shipped 🚀 41 tasks',
      image: 'https://pbs.twimg.com/media/abc?format=jpg', imageRatio: null,
      images: [{ url: 'https://pbs.twimg.com/media/abc?format=jpg', ratio: null }],
      publishedAt: '2026-11-04T06:58:00.000Z',
    } satisfies XTimelinePost);
    expect(Value.Check(XPostSchema, post)).toBe(true);
  });

  it('collects up to 4 unique https images in order and sets first as image', () => {
    const media = (name: string): string => `https://pbs.twimg.com/media/${name}?format=jpg`;
    const doc = page(tweet({ id: '3', handle: 'mayabuilds', name: 'Maya Chen', text: '五张图',
      photos: [media('a'), 'http://insecure.test/b.jpg', media('c'), media('a'), media('d'), media('e'),
        media('f')] }));
    const post = readPost(doc.querySelector('article') as Element, BASE)!;
    expect(post.images?.map((image) => image.url)).toEqual([media('a'), media('c'), media('d'), media('e')]);
    expect(post.image).toBe(media('a'));
    expect(Value.Check(XPostSchema, post)).toBe(true);
    const plain = readPost(page(tweet({ id: '4', handle: 'mayabuilds', name: 'Maya Chen', text: '没图' }))
      .querySelector('article') as Element, BASE)!;
    expect(plain.images).toEqual([]);
    expect(plain.image).toBeNull();
  });

  it('skips ads without time link and deduplicates posts across pagination', () => {
    const seen = new Map<string, XTimelinePost>();
    const doc = page(tweet({ id: '1', handle: 'linjian_dev', name: '林间', text: '第一条' })
      + tweet({ id: '9', handle: 'brand', name: '广告', text: '买买买', ad: true }));
    expect(collectPosts(doc, BASE, seen)).toBe(1);
    page(tweet({ id: '1', handle: 'linjian_dev', name: '林间', text: '第一条' })
      + tweet({ id: '2', handle: 'linjian_dev', name: '林间', text: '第二条' }));
    expect(collectPosts(document, BASE, seen)).toBe(2);
    expect([...seen.values()].map((post) => post.text)).toEqual(['第一条', '第二条']);
  });

  it('tracks truncated long posts on timeline and reads full text on detail page, or null if cut', () => {
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
