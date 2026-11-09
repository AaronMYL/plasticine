// 按实际调用用途配置；图书引用进入主对话，联系人与群聊共用代答用途。
// 2026-11-07《优化清单》第 13 条：加旁聊（默认跟主线）、心跳、做梦（默认用便宜的）、回顾、研究员；
// 设置里成组的折成一行（group），点开再分开配。
//
// fallback：没单独设时跟谁。default 是全局默认；main 是主线；cheap 是全局默认那一家里已启用、目录价最低的模型。
// thinking：没单独选思考档时用这一档，不跟 fallback 的档。2026-11-09 他定：笔记续写、主动补充不开思考（要停下就有）；
// 模型不支持「关」就用它支持的最低档（model-resolve.ts 夹档，不算问题）。

export const MODEL_PURPOSE_FALLBACKS = ['default', 'main', 'cheap'] as const;
export type ModelPurposeFallback = (typeof MODEL_PURPOSE_FALLBACKS)[number];

export const MODEL_PURPOSE_GROUPS = {
  chat: '主线和旁聊',
  notes: '笔记',
  books: '图书',
  misc: '信息流、记忆、记账',
} as const;
export type ModelPurposeGroup = keyof typeof MODEL_PURPOSE_GROUPS;

interface PurposeEntry {
  readonly id: string;
  readonly label: string;
  readonly group: ModelPurposeGroup | null;
  readonly fallback: ModelPurposeFallback;
  readonly thinking?: 'off';
}

export const MODEL_PURPOSES = [
  { id: 'main', label: '主线', group: 'chat', fallback: 'default' },
  { id: 'side', label: '旁聊', group: 'chat', fallback: 'main' },
  { id: 'agent', label: '后台线（子代理）', group: null, fallback: 'default' },
  { id: 'heartbeat', label: '心跳', group: null, fallback: 'cheap' },
  { id: 'dream', label: '做梦', group: null, fallback: 'cheap' },
  { id: 'review', label: '回顾（日报 / 周报）', group: null, fallback: 'default' },
  { id: 'researcher', label: '研究员（订阅周报）', group: null, fallback: 'default' },
  { id: 'translation', label: '翻译', group: null, fallback: 'default' },
  { id: 'network_reply', label: '联系人和群代答', group: null, fallback: 'default' },
  { id: 'compaction', label: '对话压缩', group: null, fallback: 'default' },
  { id: 'note_predict', label: '续写', group: 'notes', fallback: 'default', thinking: 'off' },
  { id: 'note_interject', label: '主动补充', group: 'notes', fallback: 'default', thinking: 'off' },
  { id: 'note_polish', label: '润色', group: 'notes', fallback: 'default' },
  { id: 'note_organize', label: '整理结构', group: 'notes', fallback: 'default' },
  { id: 'note_correct', label: '语音纠偏', group: 'notes', fallback: 'default' },
  { id: 'note_format', label: '排版', group: 'notes', fallback: 'default' },
  { id: 'note_chart', label: '图表化', group: 'notes', fallback: 'default' },
  { id: 'note_custom', label: '按要求修改', group: 'notes', fallback: 'default' },
  { id: 'book_digest', label: '章节归纳', group: 'books', fallback: 'default' },
  { id: 'book_outline', label: '生成大纲', group: 'books', fallback: 'default' },
  { id: 'book_key_points', label: '提炼重点', group: 'books', fallback: 'default' },
  { id: 'feed_selection', label: '信息流选材与摘要', group: 'misc', fallback: 'default' },
  { id: 'feed_comment', label: '信息流评论回复', group: 'misc', fallback: 'default' },
  { id: 'memory_curate', label: '对话记忆整理', group: 'misc', fallback: 'default' },
  { id: 'memory_compact', label: '记忆合并压缩', group: 'misc', fallback: 'default' },
  { id: 'payment_read', label: '付款截图识别', group: 'misc', fallback: 'default' },
  // 第 6 批第 9 条：视频解析（预览、逐字稿总结、图文读图），对话、后台线和抖音收藏共用。
  { id: 'video_digest', label: '视频解析', group: 'misc', fallback: 'default' },
] as const satisfies readonly PurposeEntry[];

export type ModelPurpose = (typeof MODEL_PURPOSES)[number]['id'];
export const MODEL_PURPOSE_IDS = MODEL_PURPOSES.map((purpose) => purpose.id);

export function purposeInfo(purpose: ModelPurpose): PurposeEntry {
  const found = MODEL_PURPOSES.find((item) => item.id === purpose);
  if (found === undefined) {
    throw new Error(`没有这个模型用途：${purpose}`);
  }
  return found;
}

export function requiresImages(purpose: ModelPurpose | undefined): boolean {
  return purpose === 'payment_read';
}
