export const PROVIDER_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  openai: 'ChatGPT',
  anthropic: 'Claude',
  deepseek: 'DeepSeek',
  'moonshotai-cn': 'Kimi',
  'qwen-token-plan-cn': '通义千问',
  zai: '智谱',
  'minimax-cn': 'MiniMax',
};

export function providerDisplayName(provider: { id: string; name: string }): string {
  return PROVIDER_DISPLAY_NAMES[provider.id] ?? provider.name;
}
