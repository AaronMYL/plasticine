// 界面上一个项目的小标记：名字 + 一种颜色（2026-11-02 第 102 条：视觉规范放开，颜色可以表达项目）。
// 首页卡、事列表、记忆主题目录都用它。颜色只是这几档名字，客户端在 tokens.css 里按名字取浅 / 深色值。
// 设计稿阶段：项目表里还没有颜色这一列，假接口按项目 id 固定配一种；真接口下一批加列，用户可改。

import { Type, type Static } from 'typebox';
import { IdSchema } from './common.ts';

/** 项目颜色只在这六档里挑；陶土橙留给「等你」，不给项目。 */
// 11-11 第 11 批加 plum、indigo，凑成八色（Aaron 同意）。
export const PROJECT_HUES = ['ochre', 'teal', 'sky', 'rose', 'olive', 'slate', 'plum', 'indigo'] as const;
export type ProjectHue = (typeof PROJECT_HUES)[number];

export const ProjectTagSchema = Type.Object({
  id: IdSchema,
  name: Type.String({ minLength: 1 }),
  hue: Type.Enum(PROJECT_HUES),
});
export type ProjectTag = Static<typeof ProjectTagSchema>;
