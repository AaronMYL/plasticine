import type { NativeImage } from 'electron';
import { TabActionError, type StepReporter } from '../node/action-runner.ts';

const CAPTURE_MS = 8_000;
const BOTTOM_SETTLE_MS = 200;
const SHOT_QUALITY = 80;

export interface ShotTabTarget {
  id: string;
  url(): string;
  visible(): boolean;
  setVisible(visible: boolean): void;
  invalidate(): void;
  capturePage(options?: { stayHidden?: boolean }): Promise<NativeImage>;
  toBottom(): void;
  viewing(): boolean;
  viewport(): Promise<{ width: number; height: number }>;
}

export interface ShotOptions {
  captureMs?: number;
  settleMs?: number;
}

function within<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(null), ms);
    promise.then((value) => {
      clearTimeout(timer);
      resolve(value);
    }, (error: unknown) => {
      clearTimeout(timer);
      reject(error instanceof Error ? error : new Error(String(error)));
    });
  });
}

async function capture(promise: Promise<NativeImage>, ms: number): Promise<NativeImage | null> {
  try {
    return await within(promise, ms);
  } catch {
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function shotFromBottom(target: ShotTabTarget, captureMs: number, settleMs: number): Promise<NativeImage | null> {
  target.toBottom();
  target.setVisible(true);
  try {
    target.invalidate();
    await sleep(settleMs);
    return await capture(target.capturePage(), captureMs);
  } finally {
    if (!target.viewing()) {
      target.setVisible(false);
    }
  }
}

export async function captureTabShot(target: ShotTabTarget, step: StepReporter, options: ShotOptions = {})
  : Promise<Record<string, unknown>> {
  const captureMs = options.captureMs ?? CAPTURE_MS;
  const settleMs = options.settleMs ?? BOTTOM_SETTLE_MS;
  step('读标签的视口大小');
  const size = await target.viewport();
  const width = Number(size.width);
  const height = Number(size.height);
  step('截标签画面');
  let image = await capture(target.capturePage({ stayHidden: true }), captureMs);
  if ((image === null || image.isEmpty()) && !target.visible()) {
    step('标签在后台：垫到最底层短暂显示再截');
    image = await shotFromBottom(target, captureMs, settleMs);
  }
  if (image === null || image.isEmpty()) {
    throw new TabActionError(null, '这个标签现在截不到画面（可能还没载入完），过一会儿再试。');
  }
  step('压成 JPEG');
  const jpeg = image.resize({ width, height }).toJPEG(SHOT_QUALITY).toString('base64');
  return { tabId: target.id, url: target.url(), jpeg, width, height };
}
