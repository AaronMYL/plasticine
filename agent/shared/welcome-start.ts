// SPDX-License-Identifier: Apache-2.0
// 欢迎消息下面的「开始」（2026-11-08《首次使用流程》）。接口约定在 api/account.ts（从这里转出去）；线的消息视图
// （api/lines.ts）也用它。单放一个文件、只引 typebox：account.ts 和 lines.ts 互相牵扯的引用链会成环。

import { Type, type Static } from 'typebox';

/** 欢迎消息下面的「开始」：点了把 prompt 当他说的话发进主线。 */
export const WelcomeStartSchema = Type.Object({
  id: Type.String({ minLength: 1, maxLength: 40 }),
  label: Type.String({ minLength: 1, maxLength: 20 }),
  icon: Type.String({ minLength: 1, maxLength: 30 }),
  prompt: Type.String({ minLength: 1, maxLength: 500 }),
}, { additionalProperties: false });
export type WelcomeStart = Static<typeof WelcomeStartSchema>;
