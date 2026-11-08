// 一份对话记录、三个容器（《UI 方案》第 4 节）：电脑右侧对话栏、记录整页、手机底部抽屉。
// 三个容器的规则一样（不限条数、同一份草稿和滚动位置），只有排版不同。

export const CONVERSATION_CONTAINERS = ['column', 'page', 'sheet'] as const;

export type ConversationContainer = (typeof CONVERSATION_CONTAINERS)[number];
