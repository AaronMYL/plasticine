import { CloudToolError } from './errors.ts';
import { ToolFailure, ToolUncertain } from '../tools/index.ts';

export async function browserResult<T>(work: () => Promise<T>, sideEffect = false): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof CloudToolError && error.code === 'user_takeover') {
      const message = '用户接手了。请等用户操作结束；已发出的动作先核对画面，不要自动重做。';
      throw sideEffect ? new ToolUncertain(message) : new ToolFailure(message);
    }
    if (sideEffect && error instanceof CloudToolError && error.code === 'unknown') {
      throw new ToolUncertain('浏览器动作结果不明，请先核对画面，不要自动重做。');
    }
    throw error;
  }
}
