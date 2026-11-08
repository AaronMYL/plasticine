import { ApiError } from '../errors.ts';

export async function lookupResult<T>(read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof ApiError && error.status === 404 && error.code === 'result_not_found') {
      return null;
    }
    throw error;
  }
}
