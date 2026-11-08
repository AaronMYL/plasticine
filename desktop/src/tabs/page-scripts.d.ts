// 构建时由 build/bundle.ts 生成（client/src/mac/circle-page.ts、page-operate.ts 里那两段脚本原样包成函数），
// 只写一份、Mac / Electron 共用；这里只给类型。
declare module 'plasticine:page-scripts' {
  /** 圈一块：回 { text, url, title } 的 JSON 字符串，按 Esc 或 cancel 回 null。 */
  export function circlePage(): Promise<string | null>;
  /** 问这一页 → 感知并操作整页：request 是 { op: 'perceive' | 'act' | 'read', … }，回 JSON 字符串。 */
  export function pageOperate(request: unknown): Promise<string>;
}
