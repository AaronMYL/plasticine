import { useEffect, useRef, useState } from 'react';
import { useApi } from '../api/context.tsx';
import { errorText } from '../api/errors.ts';
import { createRequestId } from '../api/request-id.ts';
import type { NoteImageRequest } from '../api/shared.ts';
import { dismissToast, showToast } from '../primitives/toast/index.tsx';
import { readPageSnapshot } from '../views/conversation/ask-this-page.tsx';
import type { WebChrome } from './web-chrome.ts';
import type { NativeWebTabs } from './use-native-web-tabs.ts';
import { circleQuote, circleResult, clipMarkdown, imageFile, noteHeader, screenshotMarkdown } from './web-tools.ts';

type WebNotice =
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
  report: (text: string) => void;
  capture: (scope: CaptureScope, target: CaptureTarget) => void;
  clip: () => void;
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
  const [circling, setCircling] = useState(false);
  const latest = useRef(page);
  latest.current = page;
  const busy = useRef(false);

  const circlingRef = useRef(circling);
  circlingRef.current = circling;
  const nativeRef = useRef(native);
  nativeRef.current = native;
  useEffect(() => () => {
    if (circlingRef.current) {
      nativeRef.current?.tool(page.tabId, { kind: 'circle_cancel' })
        .catch((cause: unknown) => console.warn('圈一块没能取消', cause));
    }
  }, [page.tabId]);

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

  const setNotice = (notice: WebNotice | null): void => {
    if (notice === null) {
      dismissToast();
    } else if (notice.kind === 'busy') {
      showToast({ text: notice.text, persist: true });
    } else if (notice.kind === 'error') {
      showToast({ text: notice.text, tone: 'error' });
    } else {
      const chrome = web;
      showToast(chrome === null ? { text: notice.text }
        : { text: notice.text, action: { label: '打开', run: () => chrome.openNote(notice.noteId) } });
    }
  };

  const run = (busyText: string, job: () => Promise<WebNotice | null>, failure: string): void => {
    if (busy.current) {
      return;
    }
    busy.current = true;
    setNotice({ kind: 'busy', text: busyText });
    job().then((next) => setNotice(next)).catch((cause: unknown) => {
      console.warn(failure, cause);
      setNotice({ kind: 'error', text: `${failure}：${errorText(cause)}。请重试。` });
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
    report: (text) => setNotice({ kind: 'error', text }),
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
