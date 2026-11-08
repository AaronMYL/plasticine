import twitterText from 'twitter-text';
/** X 官方 twitter-text v3：中文和 emoji 权重为 2，URL 使用 t.co 计数。 */
export function xTextLength(text: string): number { return twitterText.parseTweet(text).weightedLength; }
export function xTextValid(text: string): boolean { return twitterText.parseTweet(text).valid; }
