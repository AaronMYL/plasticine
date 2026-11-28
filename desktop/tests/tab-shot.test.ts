import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { NativeImage } from 'electron';
import { TabActionError } from '../src/node/action-runner.ts';
import { captureTabShot, type ShotTabTarget } from '../src/tabs/tab-shot.ts';

interface FakeTargetSetup {
  visible: boolean;
  capturePage(options?: { stayHidden?: boolean }): Promise<NativeImage>;
}

function fakeImage(payload: string): NativeImage {
  const bytes = Buffer.from(payload);
  return {
    isEmpty: () => false,
    resize: () => ({ toJPEG: () => bytes }),
  } as unknown as NativeImage;
}

function setupTarget(setup: FakeTargetSetup): { target: ShotTabTarget; trace: string[]; getVisible: () => boolean } {
  const trace: string[] = [];
  let visible = setup.visible;
  const target: ShotTabTarget = {
    id: 't1',
    url: () => 'https://example.test/',
    visible: () => visible,
    setVisible: (next: boolean) => {
      visible = next;
      trace.push(`setVisible:${String(next)}`);
    },
    invalidate: () => {
      trace.push('invalidate');
    },
    capturePage: setup.capturePage,
    toBottom: () => {
      trace.push('toBottom');
    },
    viewing: () => false,
    viewport: async () => ({ width: 1280, height: 800 }),
  };
  return { target, trace, getVisible: () => visible };
}

test('tab_shot falls back to bottom-layer capture when stayHidden capture rejects on hidden tab', async () => {
  const steps: string[] = [];
  const { target, trace, getVisible } = setupTarget({
    visible: false,
    capturePage: async (options) => {
      trace.push(`capture:${String(options?.stayHidden === true)}`);
      if (options?.stayHidden === true) {
        throw new Error('UnknownVizError');
      }
      return fakeImage('jpeg-bytes');
    },
  });
  const result = await captureTabShot(target, (step) => steps.push(step), { settleMs: 0 });
  assert.equal(result.tabId, 't1');
  assert.equal(result.jpeg, Buffer.from('jpeg-bytes').toString('base64'));
  assert.equal(getVisible(), false);
  assert.deepEqual(trace, ['capture:true', 'toBottom', 'setVisible:true', 'invalidate', 'capture:false',
    'setVisible:false']);
  assert.ok(steps.includes('标签在后台：垫到最底层短暂显示再截'));
});

test('tab_shot restores hidden visibility and reports TabActionError when all capture attempts reject', async () => {
  const { target, trace, getVisible } = setupTarget({
    visible: false,
    capturePage: async (options) => {
      trace.push(`capture:${String(options?.stayHidden === true)}`);
      throw new Error('Current display surface not available for capture');
    },
  });
  await assert.rejects(
    () => captureTabShot(target, () => undefined, { settleMs: 0 }),
    (error: unknown) => error instanceof TabActionError && /截不到画面/.test(error.message),
  );
  assert.equal(getVisible(), false);
  assert.deepEqual(trace, ['capture:true', 'toBottom', 'setVisible:true', 'invalidate', 'capture:false',
    'setVisible:false']);
});

test('tab_shot captures visible tab directly without reordering or toggling visibility', async () => {
  const { target, trace } = setupTarget({
    visible: true,
    capturePage: async (options) => {
      trace.push(`capture:${String(options?.stayHidden === true)}`);
      return fakeImage('visible-jpeg');
    },
  });
  const result = await captureTabShot(target, () => undefined, { settleMs: 0 });
  assert.equal(result.jpeg, Buffer.from('visible-jpeg').toString('base64'));
  assert.deepEqual(trace, ['capture:true']);
});
