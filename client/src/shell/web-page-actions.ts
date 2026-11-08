// 网页工具条上要等原生、要等服务端的几样（第 2 批「浏览器」，设计稿 Web-Menu / Web-Ask）：截图（可见部分 / 整页，
// 给 Plasticine 或存进笔记）、整页存进笔记（剪藏，带来源）、圈一块（变成对话框输入框里的引用片）、打印、下载、复制链接。
// 一次只做一样；做的时候、做完存进了笔记、出错了在工具条下面一行说一句（role=status），出错写原因和下一步。
// 交给 Plasticine 的（截图、圈的一块）不另外说：对话框展开、输入框里就看得到。

import { useEffect, useRef, useState } from 'react';
import { useApi } from '../api/context.tsx';
import { errorText } from '../api/errors.ts';
import { createRequestId } from '../api/request-id.ts';
import type { NoteImageRequest } from '../api/shared.ts';
import { readPageSnapshot } from '../views/conversation/ask-this-page.tsx';
import type { WebChrome } from './web-chrome.ts';
import type { NativeWebTabs } from './use-native-web-tabs.ts';
import { circleQuote, circleResult, clipMarkdown, imageFile, noteHeader, screenshotMarkdown } from './web-tools.ts';

/** 「存进了笔记」这一句留多久（毫秒）：够看一眼、点「打开」。 */
export const NOTICE_MS = 6_000;

export type WebNotice =
  | { kind: 'busy'; text: string }
  | { kind: 'saved'; text: string; noteId: string; noteTitle: string }
  | { kind: 'error'; text: string };

export type CaptureScope = 'visible' | 'full';
export type CaptureTarget = 'plasticine' | 'note';

export interface WebPage {
  tabId: string;
  url: string;
  title: string;
}

export interface WebPageActions {
  notice: WebNotice | null;
  dismiss: () => void;
  capture: (scope: CaptureScope, target: CaptureTarget) => void;
  clip: () => void;
  /** 正在圈：圈一块的按钮按下着，再点一下取消。 */
  circling: boolean;
  circle: () => void;
  print: () => void;
  downloads: () => void;
  copyLink: () => void;
}

function base64Of(file: File): Promise<string> {
  return file.arrayBuffer().then((buffer) => {
    let binary = '';
    for (const byte of new Uint8Array(buffer)) {
      binary += String.fromCharCode(byte);
    }
    return btoa(binary);
  });
}

export function useWebPageActions(page: WebPage, native: NativeWebTabs | null, web: WebChrome | null):
  WebPageActions {
  const api = useApi();
  const [notice, setNotice] = useState<WebNotice | null>(null);
  const [circling, setCircling] = useState(false);
  const latest = useRef(page);
  latest.current = page;
  const busy = useRef(false);

  useEffect(() => {
    if (notice?.kind !== 'saved') {
      return undefined;
    }
    const timer = window.setTimeout(() => setNotice(null), NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [notice]);
  const circlingRef = useRef(circling);
  circlingRef.current = circling;
  const nativeRef = useRef(native);
  nativeRef.current = native;
  // 离开这个标签时还在圈：取消，不让别的标签的圈一块挂着。
  useEffect(() => () => {
    if (circlingRef.current) {
      nativeRef.current?.tool(page.tabId, { kind: 'circle_cancel' })
        .catch((cause: unknown) => console.warn('圈一块没能取消', cause));
    }
  }, [page.tabId]);

  // 圈的时候键盘焦点多半还在 Plasticine 这边（刚点了圈一块的按钮），网页里的脚本收不到 Esc：这里收下转给原生取消。
  useEffect(() => {
    if (!circling) {
      return undefined;
    }
    const escape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        nativeRef.current?.tool(latest.current.tabId, { kind: 'circle_cancel' })
          .catch((cause: unknown) => console.warn('圈一块没能取消', cause));
      }
    };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [circling]);

  const run = (busyText: string, job: () => Promise<WebNotice | null>, failure: string): void => {
    if (busy.current) {
      return;
    }
    busy.current = true;
    setNotice({ kind: 'busy', text: busyText });
    job().then((next) => setNotice(next)).catch((cause: unknown) => {
      console.warn(failure, cause);
      setNotice({ kind: 'error', text: `${failure}：${errorText(cause)}。再试一次。` });
    }).finally(() => {
      busy.current = false;
    });
  };

  const saveNote = async (markdown: string, title: string): Promise<WebNotice> => {
    const note = await api.notes.create({ requestId: createRequestId(), markdown });
    return { kind: 'saved', text: '存进了笔记', noteId: note.id, noteTitle: title };
  };

  const capture = (scope: CaptureScope, target: CaptureTarget): void => {
    if (native === null) {
      return;
    }
    const { tabId, url, title } = latest.current;
    run(scope === 'full' ? '正在截整页…' : '正在截图…', async () => {
      const at = new Date();
      const file = imageFile(await native.tool(tabId, { kind: 'capture', scope }), `截图 ${title}`.trim());
      if (target === 'plasticine') {
        await web?.attach([file]);
        return null;
      }
      const note = await api.notes.create({ requestId: createRequestId(), markdown: noteHeader({ title, url }, at) });
      const image = await api.notes.uploadImage(note.id, { requestId: createRequestId(),
        type: file.type as NoteImageRequest['type'], data: await base64Of(file) });
      await api.notes.save(note.id, { requestId: createRequestId(), version: note.version,
        markdown: screenshotMarkdown({ title, url }, image.url, at) });
      return { kind: 'saved', text: '截图存进了笔记', noteId: note.id, noteTitle: title };
    }, '截图没成');
  };

  const clip = (): void => {
    const { tabId, title } = latest.current;
    run('正在存进笔记…', async () => {
      const snapshot = await readPageSnapshot(tabId);
      if (snapshot === null) {
        throw new Error('这里读不到网页正文');
      }
      return saveNote(clipMarkdown(snapshot, new Date()), title);
    }, '没能存进笔记');
  };

  const circle = (): void => {
    if (native === null) {
      return;
    }
    const { tabId } = latest.current;
    if (circling) {
      setCircling(false);
      native.tool(tabId, { kind: 'circle_cancel' }).catch((cause: unknown) => console.warn('圈一块没能取消', cause));
      return;
    }
    setCircling(true);
    native.tool(tabId, { kind: 'circle' }).then((raw) => {
      const result = circleResult(raw);
      if (result !== null) {
        web?.quote(circleQuote(result, new Date()));
      }
    }).catch((cause: unknown) => {
      console.warn('圈一块没成', cause);
      setNotice({ kind: 'error', text: `圈一块没成：${errorText(cause)}。再圈一次。` });
    }).finally(() => setCircling(false));
  };

  const simple = (kind: 'print' | 'downloads', failure: string) => (): void => {
    native?.tool(latest.current.tabId, { kind }).catch((cause: unknown) => {
      console.warn(failure, cause);
      setNotice({ kind: 'error', text: `${failure}：${errorText(cause)}。` });
    });
  };

  return {
    notice,
    dismiss: () => setNotice(null),
    capture,
    clip,
    circling,
    circle,
    print: simple('print', '没能打开打印'),
    downloads: simple('downloads', '没能打开下载的文件'),
    copyLink: () => {
      navigator.clipboard?.writeText(latest.current.url).catch((cause: unknown) => {
        console.warn('链接没能复制', cause);
        setNotice({ kind: 'error', text: '链接没能复制：剪贴板不让写。' });
      });
    },
  };
}
