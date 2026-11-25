import { chmod, lstat, unlink } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import {
  MAINTENANCE_COMMAND_PATH,
  MaintenanceRequestSchema,
  type MaintenanceError,
} from '../../shared/api/maintenance.ts';
import { errorCategory, safeLog } from '../util/index.ts';
import { ApiError } from './api-error.ts';
import { readJsonBody, sendJson } from './http.ts';
import { MaintenanceFailure, performMaintenance, type MaintenanceDeps } from './maintenance.ts';
import { checkInput } from './validate.ts';

const MAINTENANCE_BODY_BYTES = 64 * 1024;
const SOCKET_MODE = 0o600;

export interface MaintenanceSocket {
  close(): Promise<void>;
}

function failure(res: ServerResponse, status: number, body: MaintenanceError): void {
  sendJson(res, status, body);
}

async function handle(deps: MaintenanceDeps, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST' || req.url !== MAINTENANCE_COMMAND_PATH) {
    failure(res, 404, { error: 'not_found', message: `维护入口只认 POST ${MAINTENANCE_COMMAND_PATH}。` });
    return;
  }
  try {
    const body = checkInput(MaintenanceRequestSchema, await readJsonBody(req, MAINTENANCE_BODY_BYTES), '维护命令');
    sendJson(res, 200, await performMaintenance(deps, body));
  } catch (error) {
    if (error instanceof MaintenanceFailure) {
      const status = error.code === 'not_found' ? 404 : error.code === 'unavailable' ? 503 : 400;
      failure(res, status, { error: error.code, message: error.message });
      return;
    }
    if (error instanceof ApiError) {
      failure(res, error.status, { error: error.code, message: error.message });
      return;
    }
    safeLog('error', 'maintenance_request_failed', { category: errorCategory(error) });
    failure(res, 500, { error: 'unexpected', message: '维护命令出了意外，没法确定有没有生效；先用 status 或 tasks.list 核对。' });
  }
}

async function clearStale(path: string): Promise<void> {
  let info;
  try {
    info = await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return;
    }
    throw error;
  }
  if (!info.isSocket()) {
    throw new Error(`${path} 已经存在，而且不是 socket，维护入口没有开`);
  }
  await unlink(path);
}

function listen(server: Server, path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(path, () => {
      server.off('error', reject);
      resolve();
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  });
}

export async function openMaintenanceSocket(path: string, deps: MaintenanceDeps): Promise<MaintenanceSocket> {
  await clearStale(path);
  const server = createServer((req, res) => {
    void handle(deps, req, res);
  });
  await listen(server, path);
  await chmod(path, SOCKET_MODE);
  safeLog('log', 'maintenance_socket_opened');
  return {
    close: () => closeServer(server),
  };
}
