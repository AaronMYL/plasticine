// 新内核的路由条目（router.ts 摊进 ROUTES）：线（shared/api/lines.ts）和模型连接（shared/api/model-providers.ts）。
// 都要设备会话。旧路由一条不动。

import { CHATS_PATH, LINES_PATH, MODEL_CONFIG_PATH, MODEL_DEFAULT_PATH, MODEL_PROVIDERS_PATH, SIDE_PATH }
  from '../../shared/api/index.ts';
import type { Route } from './context.ts';
import { listChats, openSideChat, reactLineMessage } from './side-chats.ts';
import { answerLineWidget } from './line-widgets.ts';
import { archiveLine, restoreLine, listLines, readLine, readLineDetails, retryLine, sendLineMessage, sendQueuedNow,
  stopLine, withdrawQueued }
  from './lines.ts';
import { cancelProviderLogin, completeProviderLogin, getProviderLogin, listModelProviders, logoutProvider,
  saveModelConfig, setDefaultModel, setProviderKey, startProviderLogin } from './model-providers.ts';

const PROVIDER = `${MODEL_PROVIDERS_PATH}/:id`;
const LOGIN = `${PROVIDER}/login/:loginId`;

export const LINE_ROUTES: readonly Route[] = [
  { method: 'GET', path: LINES_PATH, auth: true, handler: listLines },
  // 写在 :id 前面：chats、side 不是线的 id。
  { method: 'GET', path: CHATS_PATH, auth: true, handler: listChats },
  { method: 'POST', path: SIDE_PATH, auth: true, handler: openSideChat },
  { method: 'POST', path: `${LINES_PATH}/:id/reactions`, auth: true, handler: reactLineMessage },
  { method: 'GET', path: `${LINES_PATH}/:id`, auth: true, handler: readLine },
  { method: 'GET', path: `${LINES_PATH}/:id/details`, auth: true, handler: readLineDetails },
  { method: 'POST', path: `${LINES_PATH}/:id/messages`, auth: true, handler: sendLineMessage },
  { method: 'POST', path: `${LINES_PATH}/:id/queue/:queueId/withdraw`, auth: true, handler: withdrawQueued },
  { method: 'POST', path: `${LINES_PATH}/:id/queue/:queueId/send-now`, auth: true, handler: sendQueuedNow },
  { method: 'POST', path: `${LINES_PATH}/:id/widgets`, auth: true, handler: answerLineWidget },
  { method: 'POST', path: `${LINES_PATH}/:id/stop`, auth: true, handler: stopLine },
  { method: 'POST', path: `${LINES_PATH}/:id/retry`, auth: true, handler: retryLine },
  { method: 'POST', path: `${LINES_PATH}/:id/archive`, auth: true, handler: archiveLine },
  { method: 'POST', path: `${LINES_PATH}/:id/restore`, auth: true, handler: restoreLine },
  { method: 'GET', path: MODEL_PROVIDERS_PATH, auth: true, handler: listModelProviders },
  { method: 'POST', path: `${PROVIDER}/login`, auth: true, handler: startProviderLogin },
  { method: 'GET', path: LOGIN, auth: true, handler: getProviderLogin },
  { method: 'POST', path: `${LOGIN}/complete`, auth: true, handler: completeProviderLogin },
  { method: 'POST', path: `${LOGIN}/cancel`, auth: true, handler: cancelProviderLogin },
  { method: 'POST', path: `${PROVIDER}/key`, auth: true, handler: setProviderKey },
  { method: 'POST', path: `${PROVIDER}/logout`, auth: true, handler: logoutProvider },
  { method: 'POST', path: MODEL_DEFAULT_PATH, auth: true, handler: setDefaultModel },
  { method: 'POST', path: MODEL_CONFIG_PATH, auth: true, handler: saveModelConfig },
];
