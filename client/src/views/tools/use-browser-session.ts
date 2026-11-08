import { useCallback, useEffect, useRef, useState } from 'react';
import { useApi } from '../../api/context.tsx';
import type {
  BrowserActionInput, BrowserActionRequest, BrowserFrame, BrowserTabAction, BrowserViewDto, BrowserViewport,
} from '../../api/shared.ts';

// 只在内存里顺序发送；鼠标移动丢掉拥塞的中间点，文字分段避免超过单次输入上限。
const INPUT_CHUNK_CHARS = 2_000;
const MAX_PENDING = 200;

interface PressedKey {
  tabId: string;
  action: BrowserActionInput & { kind: 'key' };
  sent: boolean;
  releasing: boolean;
  releaseRequest?: BrowserActionRequest;
}
interface QueueOptions {
  move?: boolean;
  done?: ((view: BrowserViewDto) => void) | undefined;
  immediate?: boolean;
  settled?: () => void;
  cleanup?: boolean;
}

export function useBrowserSession(viewport: BrowserViewport | null) {
  const { browser } = useApi();
  const [view, setView] = useState<BrowserViewDto | null>(null);
  const [frame, setFrame] = useState<BrowserFrame | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [switching, setSwitching] = useState(false);
  const [paintedTabId, setPaintedTabId] = useState<string | null>(null);
  const tabChanges = useRef(0);
  const latest = useRef<BrowserViewDto | null>(null);
  const streamId = useRef('');
  const pending = useRef(0);
  const tail = useRef<Promise<unknown>>(Promise.resolve());
  const generation = useRef(0);
  const lastSequence = useRef(0);
  const operationError = useRef<string | null>(null);
  const pressed = useRef(new Map<string, PressedKey>());
  // 同一键再次按下可以换当前记录，但上一轮待确认的释放必须保留到成功。
  const unreleased = useRef(new Set<PressedKey>());
  const releaseAll = useRef(() => {});
  const mounted = useRef(false);
  const { width, height, deviceScaleFactor } = viewport ?? {};
  const receiveView = useCallback((next: BrowserViewDto) => {
    if (next.instanceId === latest.current?.instanceId && next.revision !== undefined
      && next.revision < (latest.current?.revision ?? 0)) {
      return;
    }
    // instanceId 只属于请求去重缓存；同一画面流的在途解码和序号不能随它换代。
    if (next.activeTabId !== latest.current?.activeTabId) {
      releaseAll.current();
      setFrame(null);
      setPaintedTabId(null);
    }
    latest.current = next;
    setView(next);
  }, []);

  useEffect(() => {
    mounted.current = true;
    generation.current += 1;
    setError(null);
    operationError.current = null;
    return () => {
      mounted.current = false;
      generation.current += 1;
      releaseAll.current();
    };
  }, [browser, attempt]);

  useEffect(() => {
    if (width === undefined || height === undefined) {
      return;
    }
    let alive = true;
    releaseAll.current();
    streamId.current = crypto.randomUUID();
    const id = streamId.current;
    lastSequence.current = 0;
    setFrame(null);
    setPaintedTabId(null);
    const query = { streamId: id, width, height, deviceScaleFactor: deviceScaleFactor ?? 1 };
    const close = browser.stream(query, (event) => {
      if (!alive) {
        return;
      }
      switch (event.type) {
        case 'status':
          receiveView(event.browser);
          if (event.browser.available && operationError.current === null) {
            setError(null);
          }
          break;
        case 'frame':
          if (event.frame.sequence > lastSequence.current) {
            lastSequence.current = event.frame.sequence;
            if (event.frame.tabId === latest.current?.activeTabId) {
              setFrame(event.frame);
              if (operationError.current === null) {
                setError(null);
              }
            } else {
              // 标签切换中迟到的旧页帧不能盖住新页，也不能把服务端的背压卡住。
              void browser.ack({ streamId: id, sequence: event.frame.sequence }).catch(() => {
                if (alive) {
                  setError('画面连接中断，请重试。');
                }
              });
            }
          }
          break;
        case 'unavailable':
          releaseAll.current();
          setFrame(null);
          setError(event.message);
      }
    }, () => {
      if (alive) {
        setError('画面连接中断，正在重连；也可以点重试。');
      }
    });
    return () => {
      alive = false;
      releaseAll.current();
      close();
    };
  }, [browser, width, height, deviceScaleFactor, attempt, receiveView]);

  const enqueue = (work: () => Promise<BrowserViewDto | void>, options: QueueOptions = {}): boolean => {
    const { move = false, done, immediate = false, settled, cleanup = false } = options;
    if (move && pending.current > 0) {
      settled?.();
      return false;
    }
    if (!cleanup && pending.current >= MAX_PENDING) {
      operationError.current = '操作发送得太快，请等画面更新后重试。';
      setError(operationError.current);
      settled?.();
      return false;
    }
    const captured = generation.current;
    pending.current += 1;
    const result = (immediate ? Promise.resolve() : tail.current).then(async () => {
      if (!cleanup && captured !== generation.current) {
        return;
      }
      try {
        const result = await work();
        if (captured === generation.current && result !== undefined) {
          receiveView(result);
          if (!cleanup) {
            operationError.current = null;
            setError(null);
          }
          done?.(result);
        }
      } catch (caught) {
        if (mounted.current && (cleanup || captured === generation.current)) {
          generation.current += 1;
          operationError.current = caught instanceof Error ? caught.message : '操作没有收到回执，请核对后重试。';
          setError(operationError.current);
          if (!cleanup) {
            releaseAll.current();
          }
        }
      }
    }).finally(() => {
      pending.current -= 1;
      settled?.();
    });
    if (!immediate) {
      tail.current = result;
    }
    return true;
  };
  const request = () => ({ requestId: crypto.randomUUID(), instanceId: latest.current?.instanceId ?? '' });
  const releaseKey = (held: PressedKey, modifiers = 0): void => {
    if (held.releasing) {
      return;
    }
    held.releasing = true;
    held.releaseRequest ??= { ...request(), tabId: held.tabId,
      action: { ...held.action, event: 'up', modifiers, repeat: false } };
    // 清理仍排在按下之后，但不受新输入门禁、拥塞上限或重连/卸载的代次取消影响。
    enqueue(async () => {
      const result = held.sent && held.releaseRequest !== undefined
        ? await browser.act(held.releaseRequest) : undefined;
      const code = held.action.code || held.action.key;
      if (pressed.current.get(code) === held) {
        pressed.current.delete(code);
      }
      unreleased.current.delete(held);
      return result?.browser;
    }, { cleanup: true, settled: () => { held.releasing = false; } });
  };
  const releaseKeys = (): void => {
    for (const held of unreleased.current) {
      releaseKey(held);
    }
  };
  releaseAll.current = releaseKeys;
  const action = (input: BrowserActionInput, done?: (view: BrowserViewDto) => void): void => {
    if (input.kind === 'key' && input.event === 'up') {
      const held = pressed.current.get(input.code || input.key);
      if (held !== undefined) {
        releaseKey(held, input.modifiers);
      }
      return;
    }
    if (tabChanges.current > 0) {
      return;
    }
    const navigation = ['back', 'forward', 'reload', 'stop'].includes(input.kind);
    const tabId = navigation ? latest.current?.activeTabId : paintedTabId;
    if (!tabId || tabId !== latest.current?.activeTabId) {
      return;
    }
    if (input.kind === 'type' && input.text.length > INPUT_CHUNK_CHARS) {
      let chunk = '';
      for (const char of input.text) {
        if (chunk.length + char.length > INPUT_CHUNK_CHARS) {
          action({ kind: 'type', text: chunk });
          chunk = '';
        }
        chunk += char;
      }
      if (chunk !== '') {
        action({ kind: 'type', text: chunk });
      }
      return;
    }
    if (navigation) {
      releaseKeys();
    }
    let held: PressedKey | undefined;
    if (input.kind === 'key' && input.event === 'down') {
      const previous = pressed.current.get(input.code || input.key);
      held = previous?.tabId === tabId && !previous.releasing
        ? previous : { tabId, action: input, sent: false, releasing: false };
    }
    const accepted = enqueue(async () => {
      if (held !== undefined) {
        held.sent = true;
      }
      return (await browser.act({ ...request(), tabId, action: input })).browser;
    }, { move: input.kind === 'move', done, immediate: input.kind === 'stop' });
    if (accepted && held !== undefined) {
      pressed.current.set(held.action.code || held.action.key, held);
      unreleased.current.add(held);
    }
  };
  return {
    view, frame, error,
    inputPaused: switching || frame === null || paintedTabId !== frame.tabId,
    retry: () => {
      releaseKeys();
      setAttempt((value) => value + 1);
    },
    open: (url: string, done?: () => void) => {
      releaseKeys();
      enqueue(() => browser.open({ ...request(), url }), { done });
    },
    tab: (action: BrowserTabAction) => {
      releaseKeys();
      tabChanges.current += 1;
      setSwitching(true);
      enqueue(() => browser.tab({ ...request(), action }), { settled: () => {
        tabChanges.current -= 1;
        setSwitching(tabChanges.current > 0);
      } });
    },
    action,
    reportError: setError,
    ack: (sequence: number) => {
      if (frame?.sequence === sequence && frame.tabId === latest.current?.activeTabId) {
        setPaintedTabId(frame.tabId);
      }
      void browser.ack({ streamId: streamId.current, sequence }).catch(() => {
        setError('画面确认失败，请重试。');
      });
    },
  };
}
