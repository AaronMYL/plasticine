// A version conflict answered with the row as it is now (409 + current), so the page can redraw it before the user
// tries again (《实施方案》第 5 节约定 3). Used by the resources whose writes carry a version.

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
