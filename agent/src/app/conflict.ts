import { StateError } from '../state/index.ts';
import { ApiError } from './api-error.ts';

export function withCurrent<T>(write: () => T, current: () => unknown, currentVersion: () => number): T {
  try {
    return write();
  } catch (error) {
    if (!(error instanceof StateError) || error.code !== 'version_conflict') {
      throw error;
    }
    const version = currentVersion();
    throw new ApiError(409, 'version_conflict', '这一条在别处改过了，这次没有改。', {
      ...(version >= 1 ? { currentVersion: version } : {}),
      next: '看 current 里的最新版，确认后用最新的 version 再来。',
      extra: { current: current() },
    });
  }
}
