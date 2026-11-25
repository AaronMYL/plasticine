import type { LineScript } from '../api/fake/fake-line-script.ts';
import type { FakeControl } from '../api/fake/index.ts';
import { DEV, MEDIA } from './plots.ts';
import { byText, click, Missed, pointAt, sleep, typeInto, waitFor, type Stage } from './stage.ts';

export interface Scene {
  id: string;
  run: (stage: Stage, control: FakeControl) => Promise<void>;
}

let callSerial = 0;

async function work(stage: Stage, control: FakeControl, lineId: string, tool: string, say: string,
  ms: number): Promise<void> {
  const toolCallId = `demo-call-${++callSerial}`;
  control.lines.change(lineId, { status: 'running', activity: `${say}…`, activeSince: new Date().toISOString() });
  control.bus.emit({ type: 'line', event: { type: 'line_tool', lineId, phase: 'started', toolCallId, tool, say,
    ok: null, summary: null, durationMs: null } });
  await sleep(stage, ms);
  control.bus.emit({ type: 'line', event: { type: 'line_tool', lineId, phase: 'ended', toolCallId, tool, say,
    ok: true, summary: say, durationMs: ms } });
}

function finish(control: FakeControl, lineId: string): void {
  control.lines.change(lineId, { status: 'idle', outcome: 'done', activity: null,
    updatedAt: new Date().toISOString() });
}

export const NEXT_SCRIPT = new Map<string, LineScript>();

async function shrink(stage: Stage): Promise<void> {
  try {
    (await waitFor(stage, () => document.querySelector<HTMLElement>('button[aria-label="缩小对话框"]'), 1500)).click();
  } catch (cause) {
    if (!(cause instanceof Missed)) throw cause;
  }
}

function leaf(text: string): HTMLElement | null {
  for (const element of document.querySelectorAll<HTMLElement>('#root *')) {
    if (element.childElementCount === 0 && (element.textContent ?? '').trim().startsWith(text)) {
      return element.closest<HTMLElement>('a, button, [role="button"]') ?? element;
    }
  }
  return null;
}

async function read(stage: Stage): Promise<void> {
  window.location.hash = '#/feed';
  await shrink(stage);
  const scroller = [...document.querySelectorAll<HTMLElement>('.shell-main-area *')]
    .filter((element) => element.scrollHeight > element.clientHeight + 200)
    .sort((a, b) => b.clientHeight - a.clientHeight)[0];
  for (let turn = 0; turn < 3; turn += 1) {
    scroller?.scrollBy({ top: 360, behavior: 'smooth' });
    await sleep(stage, 1500);
  }
  window.location.hash = '#/library';
  await shrink(stage);
  const review = await waitFor(stage, () => leaf('个人回顾'));
  await click(stage, review);
  const letter = await waitFor(stage, () => leaf('做梦，有了一组数字'));
  await pointAt(stage, letter);
  await sleep(stage, 3200);
}

interface Step {
  tool: string;
  say: string;
  ms: number;
}

export interface TeamPlot {
  group: string;
  ask: string;
  reply: LineScript;
  first: { lineId: string; steps: Step[]; handTo: string; goal: string; then: Step[] };
  second: { lineId: string; steps: Step[]; card: string; claimer: string; then: Step[] };
}

async function steps(stage: Stage, control: FakeControl, lineId: string, list: readonly Step[]): Promise<void> {
  for (const step of list) await work(stage, control, lineId, step.tool, step.say, step.ms);
  finish(control, lineId);
}

async function team(stage: Stage, control: FakeControl, plot: TeamPlot): Promise<void> {
  const roster = await control.mates.list();
  const group = roster.groups.find((row) => row.name === plot.group);
  if (group === undefined) return;
  const mate = (name: string): string => roster.mates.find((row) => row.name === name)?.id ?? '';
  window.location.hash = `#/plasticine/group/${group.id}`;
  await sleep(stage, 1600);
  NEXT_SCRIPT.set(group.lineId, plot.reply);
  const composer = await waitFor(stage, () => document.querySelector<HTMLTextAreaElement>('.shell-main-area textarea'));
  await pointAt(stage, composer);
  await typeInto(stage, composer, plot.ask);
  const send = await waitFor(stage,
    () => document.querySelector<HTMLElement>('.shell-main-area button[aria-label="发送"]'));
  await click(stage, send);
  await sleep(stage, 3200);
  const first = (async (): Promise<void> => {
    await steps(stage, control, plot.first.lineId, plot.first.steps);
    const handed = await control.mates.handoff({ requestId: `demo-handoff-${++callSerial}`,
      mateId: mate(plot.first.handTo), goal: plot.first.goal, sourceLineId: plot.first.lineId, groupId: group.id });
    await sleep(stage, 900);
    await steps(stage, control, handed.line.id, plot.first.then);
  })();
  const second = (async (): Promise<void> => {
    await steps(stage, control, plot.second.lineId, plot.second.steps);
    const open = control.lines.allLines().find((line) => line.title.startsWith(plot.second.card));
    if (open === undefined) return;
    await sleep(stage, 800);
    control.lines.change(open.id, { mateId: mate(plot.second.claimer), status: 'queued' });
    await sleep(stage, 900);
    await steps(stage, control, open.id, plot.second.then);
  })();
  await sleep(stage, 3200);
  const panel = byText('分工');
  if (panel !== null) {
    await click(stage, panel);
    await sleep(stage, 4200);
    await click(stage, panel);
  }
  await Promise.all([first, second]);
  await sleep(stage, 1500);
}

async function notes(stage: Stage): Promise<void> {
  window.location.hash = '#/notes';
  await shrink(stage);
  const editor = await waitFor(stage, () => document.querySelector<HTMLElement>('[contenteditable="true"]'));
  const hints = byText('补充建议');
  if (hints !== null) await click(stage, hints);
  await pointAt(stage, editor);
  await typeInto(stage, editor, '白天只记，夜里整理。人靠睡一觉把一天的事理顺');
  const ghost = await waitFor(stage, () => document.querySelector<HTMLElement>('.note-ghost'), 9000);
  await sleep(stage, 1200);
  await click(stage, ghost);
  await sleep(stage, 900);
  const add = await waitFor(stage, () => [...document.querySelectorAll<HTMLElement>('.shell-main-area button')]
    .find((button) => (button.textContent ?? '').trim() === '加上'), 9000);
  await click(stage, add);
  const adopt = await waitFor(stage, () => byText('采用这', '.shell-main-area button'), 9000);
  await sleep(stage, 1400);
  await click(stage, adopt);
  await sleep(stage, 2200);
}

async function messages(stage: Stage): Promise<void> {
  window.location.hash = '#/messages';
  await shrink(stage);
  const box = await waitFor(stage, () => document.querySelector<HTMLElement>(
    '.shell-main-area [contenteditable="true"], '
    + '.shell-main-area textarea'));
  await pointAt(stage, box);
  await typeInto(stage, box, '样例发你了，按这个格式来。');
  const send = await waitFor(stage,
    () => document.querySelector<HTMLElement>('.shell-main-area button[aria-label="发送"]'));
  await click(stage, send);
  await sleep(stage, 5200);
}

export const SCENES: readonly Scene[] = [
  { id: 'read', run: (stage) => read(stage) },
  { id: 'media', run: (stage, control) => team(stage, control, MEDIA) },
  { id: 'notes', run: (stage) => notes(stage) },
  { id: 'messages', run: (stage) => messages(stage) },
  { id: 'dev', run: (stage, control) => team(stage, control, DEV) },
];
