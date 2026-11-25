import { Value } from 'typebox/value';
import { NoteSupplementsSchema, type NoteSupplement, type NoteSupplementReference }
  from '../../shared/api/notes-workspace.ts';

export const NOTE_SUPPLEMENTS_PROMPT = '返回 JSON 数组，最多4条有用的建议，没有可补的返回[]。'
  + '每条有kind、text、draft。kind只能是structure（结构）、supplement（补充）、example（举例）、'
  + 'contact（关联联系人或笔记）。text是一句简短建议，draft是可采用的Markdown草稿；'
  + '结构类draft给目标段落的完整修改稿，其他类型draft只给拟插入的新段。'
  + '只用已有事实；未知时间、价格等写[待确认]，不捏造经历、联系人或笔记。'
  + '关联类必须带reference，原样取自提供的references（kind/id/label），没有合适关联就不提这一类。';

export function parseNoteSupplements(raw: string, references: readonly NoteSupplementReference[]): NoteSupplement[] {
  const source = raw.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/, '$1');
  let value: unknown;
  try { value = source === '' ? [] : JSON.parse(source); }
  catch (cause) { throw new Error('补充建议的格式不对，请重试。正文没有改动。', { cause }); }
  if (!Value.Check(NoteSupplementsSchema, value)) {
    throw new Error('补充建议的格式不对，请重试。正文没有改动。');
  }
  for (const item of value) {
    const ref = item.reference;
    if (item.kind === 'contact' && ref === undefined || ref !== undefined
      && !references.some((known) => known.kind === ref.kind && known.id === ref.id && known.label === ref.label)) {
      throw new Error('补充建议里的关联没有找到，请重试。正文没有改动。');
    }
  }
  return value;
}
