// 官网演示里「自媒体运营」那一组：四位虚构队友、一个群组，群里的事各种状态都有一件。全是虚构的人和事。

import type { FakeLines } from '../api/fake/fake-lines.ts';
import type { FakeMates } from '../api/fake/fake-mates.ts';
import type { MateCharacter, MateFace, MateVariant, MateView } from '../api/shared.ts';

export async function seedMediaScene({ mates, lines }: { mates: FakeMates; lines: FakeLines },
  now: Date): Promise<void> {
  const make = (name: string, look: [MateCharacter, MateVariant, MateFace], hue: MateView['hue'],
    role: string) => mates.create({ requestId: `scene-media-${look[0]}`, name, avatar: look[0], variant: look[1],
    face: look[2], hue, role, soul: '', purpose: null });
  const [topic, writer, editor, ops] = await Promise.all([
    make('选题编辑', ['mochi', 'paper', 'eyes'], 'ochre', '从信息流和来信里挑选题'),
    make('文案', ['cloud', 'soft', 'line'], 'indigo', '把选题写成口播稿'),
    make('剪辑师', ['gem', 'riso', 'shades'], 'olive', '出封面和分镜'),
    make('运营', ['leaf', 'marker', 'bigmouth'], 'slate', '排发布时间，看数据')]);
  const group = await mates.groups.create({ requestId: 'scene-media-group', name: '自媒体运营',
    mateIds: [topic.id, writer.id, editor.id, ops.id] });
  const ago = (minutes: number): string => new Date(now.getTime() - minutes * 60_000).toISOString();
  const put = (id: string, title: string, extra: Parameters<FakeLines['blank']>[3]): void => {
    lines.put(lines.blank(id, 'background', title, { parentLineId: group.lineId, mateGroupId: group.id, ...extra }));
  };
  put('media-topic', '从这周的信息流里挑三个选题', { mateId: topic.id, status: 'running',
    activity: '在看这周收藏的 12 条…', activeSince: ago(6) });
  put('media-topic-done', '整理上周来信里的读者提问', { mateId: topic.id, status: 'idle', outcome: 'done',
    updatedAt: ago(120) });
  put('media-cover', '上一期的封面两版', { mateId: editor.id, status: 'waiting', updatedAt: ago(9) });
  put('media-data', '拉上周三条视频的数据', { mateId: ops.id, status: 'running', activity: '第 2 / 3 条…',
    activeSince: ago(3) });
  await mates.groups.createTask(group.id, { requestId: 'scene-media-task', text: '把口播稿拆成分镜' });
}
