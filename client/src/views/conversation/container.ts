export const CONVERSATION_CONTAINERS = ['column', 'page', 'sheet'] as const;

export type ConversationContainer = (typeof CONVERSATION_CONTAINERS)[number];
