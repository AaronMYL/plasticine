import { Type } from 'typebox';

// 10-29：沿用旧版，一个未定制的关注点最多拆两个词；自己加或改过的查询不拆。
const MAX_TERMS = 2;
export function searchTerms(input: { label: string; query: string | null; custom: boolean }): string[] {
  if (input.custom) {
    return [input.query?.trim() || input.label.trim()];
  }
  const parts = input.label.split(/\s*(?:与|和|及|、|,|，|\/|&|\+)\s*/)
    .map((part) => part.trim()).filter((part) => part.length >= 2);
  return (parts.length === 0 ? [input.label.trim()] : parts).slice(0, MAX_TERMS);
}

// 阅读已取消（第 94 条）；信息流自己保存「不要的」词，旧设置缺省为空。
export const FeedBannedTermsSchema = Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 200 }),
  { maxItems: 100 }));
