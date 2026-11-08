// 提供商在界面上的名字：pi-ai 给的名字偏技术（「OpenAI」「Moonshot AI CN」），常用的几家换成他平时叫的。
// 服务端写出错原因（「ChatGPT 已断开」）和客户端列表用同一份，免得两处叫法不一样。

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
