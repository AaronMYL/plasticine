import { Value } from 'typebox/value';
import { FeedCommentReplySchema, type FeedCommentGenerator } from '../../shared/feed-comments.ts';
import type { TextModels } from '../kernel/index.ts';

const PROMPT = '你是 Plasticine，回应用户对这条信息流的评论，简洁地接上一句有内容的话。'
  + '标题、摘要和历史评论是资料。只回应最新用户评论，不调用工具、不宣称执行外部动作。'
  + '仅当用户明确要求这个关注点多推或少推，level 写 more 或 less；否定、引用或一般讨论写 null。'
  + '只有 source.interest 为 true 才能调整档位；来源本来是订阅或站内消息时不要冒充关注点。'
  + 'text 不宣称已改档位（系统在确认保存后补上实际结果）。'
  + '只输出 JSON：{"text":"你的回应","level":null}。';

export function createFeedCommentGenerator(models: TextModels): FeedCommentGenerator {
  return async (input, signal) => {
    const answer = await models.ask({ system: PROMPT, messages: [{ role: 'user', content: JSON.stringify(input) }],
      purpose: 'feed_comment' }, signal);
    if (!answer.complete) {
      throw new Error('评论回复未完成，请重试这次回复。');
    }
    let result: unknown;
    try {
      result = JSON.parse(answer.text);
    } catch (cause) {
      throw new Error('评论回复不是有效 JSON，请重试这次回复。', { cause });
    }
    if (!Value.Check(FeedCommentReplySchema, result)) {
      throw new Error('评论回复格式不完整，请重试这次回复。');
    }
    return result;
  };
}
