// 长期维护入口的门（第 115 条）：服务器本机的 unix socket（<PLASTICINE_STATE>/maintenance.sock，权限 0600）。
// 只有 plasticine 用户能连，Caddy 转不进来，所以不另设令牌；只认 POST /v1/maintenance 的 JSON。
// 进程被杀会留下 socket 文件：开门前确认那是个 socket 再换掉；同名的普通文件不碰。

import { chmod, lstat, unlink } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import {
  MAINTENANCE_COMMAND_PATH,
  MaintenanceRequestSchema,
  type MaintenanceError,
} from '../../shared/api/maintenance.ts';
import { errorCategory, safeLog } from '../shared-log.ts';
import { ApiError } from './api-error.ts';
import { readJsonBody, sendJson } from './http.ts';
import { MaintenanceFailure, performMaintenance, type MaintenanceDeps } from './maintenance.ts';
import { checkInput } from './validate.ts';

/** 维护命令的请求体上限：一批 200 个 id 加一句原话，64 KB 足够。 */
const MAINTENANCE_BODY_BYTES = 64 * 1024;
/** socket 只给 plasticine 用户自己（运维 Issue 里 sudo -u plasticine 调）。 */
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

/** 旧 socket 文件（上次进程被杀留下的）换掉；同名的不是 socket 就报错，不删别人的文件。 */
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
    // node 关 unix socket 服务时自己删掉文件。
    close: () => closeServer(server),
  };
}
