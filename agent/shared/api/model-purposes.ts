export const MODEL_PURPOSE_FALLBACKS = ['default', 'main', 'cheap', 'note_predict'] as const;
export type ModelPurposeFallback = (typeof MODEL_PURPOSE_FALLBACKS)[number];

export const MODEL_PURPOSE_GROUPS = {
  chat: '主线和队友',
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
  { id: 'side', label: '队友', group: 'chat', fallback: 'main' },
  { id: 'compose_predict', label: '输入建议', group: 'chat', fallback: 'note_predict', thinking: 'off' },
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
  { id: 'web_extract', label: '网页提取', group: 'misc', fallback: 'default' },
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
