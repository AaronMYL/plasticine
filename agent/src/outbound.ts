// 往外送的 JSON 整份清洗链接（规则在 link-clean.ts）：复制 JSON，不回写库、回执缓存。11-14 起只用在往外送的地方
// （推送、发给联系人和群组的信、不是他自己设备的请求），回给他自己设备的不清洗。
import { cleanOutboundText } from './link-clean.ts';

export { cleanOutboundText };

export type PreserveOutboundField = (parent: Readonly<Record<string, unknown>>, key: string) => boolean;

/** 默认清洗所有字符串；只有认证接口的序列化边界可以明确指定用户原文字段。 */
export function cleanOutboundJson<T>(value: T, preserve?: PreserveOutboundField): T {
  if (typeof value === 'string') {
    return cleanOutboundText(value) as T;
  }
  if (Array.isArray(value)) {
    return value.map((entry: unknown, index) => {
      const keep = typeof entry === 'string' && preserve?.(value as unknown as Record<string, unknown>, String(index));
      return keep ? entry : cleanOutboundJson(entry, preserve);
    }) as T;
  }
  if (typeof value === 'object' && value !== null) {
    const parent = value as Record<string, unknown>;
    return Object.fromEntries(Object.entries(parent).map(([key, entry]) => {
      const keep = typeof entry === 'string' && preserve?.(parent, key);
      return [key, keep ? entry : cleanOutboundJson(entry, preserve)];
    })) as T;
  }
  return value;
}
