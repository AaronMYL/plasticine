import type { LineView } from '../../shared/api/lines.ts';
import type { MateHandoffRequest } from '../../shared/api/mates.ts';
import { LineError, type After, type LineKernel } from '../lines/index.ts';
import type { LineRow, StateService } from '../state/index.ts';

type TaskState = Pick<StateService, 'mates' | 'mateGroups' | 'lines' | 'lineMessages' | 'transaction'>;
const immediate: After = (action) => action();

function markerOf(state: TaskState, line: LineRow) {
  const marker = state.lineMessages.first(line.id, 'notice')?.meta?.mateGroupTask;
  return line.kind === 'background' && marker?.groupId === line.mateGroupId ? marker : undefined;
}

/** 普通交接返回 null；任务卡只给原线绑定执行队友，不另开一条工作。 */
export function claimPendingGroupTask(state: TaskState, kernel: LineKernel,
  input: Omit<MateHandoffRequest, 'requestId'>, after: After = immediate): LineView | null {
  const source = kernel.line(input.sourceLineId);
  const marker = markerOf(state, source);
  if (marker === undefined) return null;
  const pending: (() => void)[] = [];
  const claimed = state.transaction(() => {
    const task = state.lines.require(source.id);
    if (task.archivedAt !== null) throw new LineError('conflict', '这张任务卡已归档。');
    if (task.mateId != null) throw new LineError('conflict', '这张任务卡已经由队友领取。');
    const group = state.mateGroups.require(marker.groupId);
    if (task.parentLineId !== group.lineId || (input.groupId != null && input.groupId !== group.id)) {
      throw new LineError('invalid', '任务卡不属于这个群组。');
    }
    if (state.lines.require(group.lineId).archivedAt !== null) {
      throw new LineError('conflict', '这张任务卡的群组已归档。');
    }
    const mate = state.mates.require(input.mateId);
    if (mate.disabledAt !== null) throw new LineError('conflict', '这位队友已停用。');
    if (!group.mateIds.includes(mate.id)) throw new LineError('invalid', '只能由这个群组的队友领取。');
    if (input.goal !== marker.goal) throw new LineError('conflict', '领取时不能更换任务目标。');
    const queued = kernel.read(task.id, 1).queue;
    if (queued.length !== 1 || queued[0]?.text !== marker.goal || task.status !== 'paused') {
      throw new LineError('conflict', '这张任务卡的待领目标已变化，不能继续领取。');
    }
    state.lines.update(task.id, { mateId: mate.id, modelPurpose: mate.purpose ?? 'main' });
    return kernel.retry(task.id, (action) => pending.push(action));
  });
  for (const action of pending) after(action);
  return claimed;
}

export class MateGroupTasks {
  readonly #state: TaskState;
  readonly #kernel: () => LineKernel;

  constructor(state: TaskState, kernel: () => LineKernel) {
    this.#state = state;
    this.#kernel = kernel;
  }

  list(groupId: string, sourceLineId?: string): LineView[] {
    const group = this.#state.mateGroups.require(groupId);
    if (sourceLineId !== undefined) this.#source(groupId, sourceLineId);
    return this.#rows(group.lineId).filter((line) => line.archivedAt === null
      && markerOf(this.#state, line)?.groupId === groupId)
      .map((line) => this.#kernel().view(line.id));
  }

  offer(input: { groupId: string; sourceLineId: string; goal: string; offerKey: string;
    user?: boolean; attachments?: readonly string[] }, after: After = immediate): LineView {
    const pending: (() => void)[] = [];
    const task = this.#state.transaction(() => {
      const source = this.#source(input.groupId, input.sourceLineId);
      const group = this.#state.mateGroups.require(input.groupId);
      if (input.goal.trim() === '' || input.goal.length > 20_000) {
        throw new LineError('invalid', '填写完整的任务目标，最多两万字。');
      }
      const previous = this.#rows(group.lineId).find((line) => {
        const marker = markerOf(this.#state, line);
        return marker?.groupId === group.id && marker.offerKey === input.offerKey;
      });
      if (previous !== undefined) {
        const marker = markerOf(this.#state, previous)!;
        if (marker.goal !== input.goal || marker.offeredByLineId !== source.id
          || JSON.stringify(marker.attachments) !== JSON.stringify(input.attachments ?? [])) {
          throw new LineError('conflict', '这个发布编号已用于另一张任务卡。');
        }
        return this.#kernel().view(previous.id);
      }
      const defer: After = (action) => pending.push(action);
      const latest = this.#state.lineMessages.last(source.id);
      const posted = this.#kernel().record(group.lineId, { text: input.goal, attachments: input.attachments ?? [],
        origin: input.user === true ? { kind: 'user', userText: input.goal }
          : { kind: 'delegation', ref: `line:${source.id}:${latest?.seq ?? 0}` } }, defer);
      if (posted.message === null) throw new LineError('conflict', '任务目标尚未写入群组，请重试。');
      const line = this.#kernel().open({ title: input.goal.trim().split('\n')[0]!.slice(0, 60), goal: input.goal,
        parentLineId: group.lineId, projectId: source.projectId, mateGroupId: group.id,
        attachments: input.attachments ?? [], origin: { kind: 'delegation',
          ref: `line:${group.lineId}:${posted.message.seq}` } }, defer);
      const now = new Date();
      this.#state.lineMessages.append(line.id, 'notice', { role: 'notice', key: `mate-task:${line.id}`,
        text: '群任务已发布，等待队友领取。', brief: '等待领取', timestamp: now.getTime() }, {
        mateGroupTask: { groupId: group.id, offerKey: input.offerKey, offeredByLineId: source.id,
          offeredAt: now.toISOString(), goal: input.goal, attachments: [...(input.attachments ?? [])] } });
      return this.#kernel().halt(line.id, defer);
    });
    for (const action of pending) after(action);
    return task;
  }

  /** 模型只能以当前执行线的真实队友身份领取，参数里没有可冒用的 mateId。 */
  claim(taskId: string, sourceLineId: string, after: After = immediate): LineView {
    const task = this.#kernel().line(taskId);
    const marker = markerOf(this.#state, task);
    if (marker === undefined) throw new LineError('invalid', '这不是群任务卡。');
    const source = this.#source(marker.groupId, sourceLineId);
    if (source.mateId == null) throw new LineError('invalid', '由组内队友领取这张任务卡。');
    return claimPendingGroupTask(this.#state, this.#kernel(), { sourceLineId: task.id, mateId: source.mateId,
      groupId: marker.groupId, goal: marker.goal }, after)!;
  }

  #rows(parentLineId: string) {
    return this.#state.lines.list({ kind: 'background', parentLineId, includeArchived: true,
      limit: Number.MAX_SAFE_INTEGER });
  }

  #source(groupId: string, sourceLineId: string): LineRow {
    const group = this.#state.mateGroups.require(groupId);
    const source = this.#kernel().line(sourceLineId);
    if (source.archivedAt !== null || this.#state.lines.require(group.lineId).archivedAt !== null) {
      throw new LineError('conflict', '先恢复这条对话和群组。');
    }
    if (source.sealedPrompt !== null) throw new LineError('invalid', '这条封闭对话不能访问队友群组。');
    if (source.mateId != null) {
      if (this.#state.mates.require(source.mateId).disabledAt !== null) {
        throw new LineError('conflict', '这位队友已停用。');
      }
      if (!group.mateIds.includes(source.mateId)) throw new LineError('invalid', '这位队友不在这个群组。');
    }
    if (source.mateGroupId != null && source.mateGroupId !== groupId) {
      throw new LineError('invalid', '只能访问当前群组的任务卡。');
    }
    return source;
  }
}
