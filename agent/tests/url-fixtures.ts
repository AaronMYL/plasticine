// 全部为程序拼出的合成攻击样本，不含真实凭据。
const nested = 'https://x.example/?token=abc';
const segment = Buffer.from('synthetic-regression-data').toString('base64url');

export const UNSAFE_QUERY_VALUES = [
  nested,
  encodeURIComponent(nested),
  encodeURIComponent(encodeURIComponent(nested)),
  '//x.example/path',
  `prefix ${nested}`,
  'g'.repeat(32),
  'a'.repeat(41),
  `${segment}.${segment}.${segment}`,
  'abc.def.ghi',
  `${'ab-_'.repeat(8)}`,
  Buffer.from('synthetic regression value for base64').toString('base64'),
  `${'ab+/'.repeat(8)}==`,
];

// 微信 sn 是文章摘要，不是访问凭据；__biz 的原始百分号编码也要保留。
export const ARTICLE_URLS = [
  `https://mp.weixin.qq.com/s?__biz=MzA5MDAwMDAwMA%3D%3D&mid=2650123456&idx=1&sn=${'0123456789abcdef'.repeat(2)}`,
  'https://news.ycombinator.com/item?id=12345678',
  'https://www.youtube.com/watch?v=AbCdEf12_-3',
  'https://example.com/a?ID=7&Topic=AI%20news&tag=%e4%b8%ad&tag=two+words&next=article&x.y=3',
];

// 正文不是 URL 字段：即使 URL 解析器会规范化，文字里也必须保留原写法。
export const TEXT_ARTICLE_URLS = [
  ...ARTICLE_URLS,
  'HTTPS://News.Example:443',
  '//News.Example',
  'https://新闻.example/文章?Topic=中文&tag=%e4%b8%ad&tag=two+words',
  'https://x.example/a/../b?ID=7&&',
  'https://x.example?',
];

export function unsafeUrl(): string {
  const query = new URLSearchParams({ page: '2', next: nested });
  for (const value of UNSAFE_QUERY_VALUES) {
    query.append('id', value);
  }
  return `https://user:pass@example.com/a?${query}#token=abc`;
}

export const SAFE_URL = 'https://example.com/a?page=2';

export const CREDENTIAL_LINK_TEXT = '旧标题 "https://u:p@x.example/?token=abc" 和 (//u:p@x.example)';
export const CLEAN_LINK_TEXT = '旧标题 "https://x.example/" 和 (//x.example)';
