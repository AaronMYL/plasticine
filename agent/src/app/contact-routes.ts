// 第 113 条的路由条目（router.ts 摊进 ROUTES）：联系人、网络账号、跨用户任务、对外可见。都要设备会话，只有邮件图片代理
// （/v2/mail-image）不要：显示邮件的沙箱 iframe 带不了 cookie，凭服务端签的短期签名（mail-view.ts）。
// 中继自己的 /v2/net/* 不在这里：中继是独立的服务（network-relay/main.ts），账号签名，不走会话。

import {
  CONTACT_LOOKUP_PATH,
  CONTACTS_ADD_PATH,
  CONTACTS_PATH,
  GROUP_TASKS_PATH,
  GROUPS_PATH,
  NETWORK_AVATAR_PATH,
  MAIL_IMAGE_PATH,
  NETWORK_INVITES_PATH,
  NETWORK_JOIN_PATH,
  NETWORK_PATH,
  NETWORK_TASKS_PATH,
  VISIBILITY_CONFIRM_PATH,
  VISIBILITY_MARKS_PATH,
  VISIBILITY_PATH,
} from '../../shared/api/index.ts';
import { addContact, confirmContactSafety, createContactTask, decideContactRequest, getContact,
  listContactMessages, listContacts, lookupContact, readContact, sendContactMessage,
  setContactRelation } from './contacts.ts';
import { cancelGroupTask, claimGroupTask, createGroup, getGroupTask, leaveGroup, updateGroup } from './groups.ts';
import type { Route } from './context.ts';
import { getContactMail, getMailImage } from './mail-view.ts';
import { cancelNetworkTask, createNetworkInvite, decideNetworkTask, deliverNetworkTask, getNetwork, getNetworkTask,
  joinNetwork, listNetworkInvites, setNetworkAvatar, stopNetworkTask, verdictNetworkTask } from './network.ts';
import { confirmVisibility, getVisibility, setVisibilityMark } from './visibility.ts';

export const CONTACT_ROUTES: readonly Route[] = [
  { method: 'GET', path: CONTACTS_PATH, auth: true, handler: listContacts },
  { method: 'POST', path: CONTACTS_ADD_PATH, auth: true, handler: addContact },
  { method: 'GET', path: CONTACT_LOOKUP_PATH, auth: true, handler: lookupContact },
  { method: 'GET', path: `${CONTACTS_PATH}/:id`, auth: true, handler: getContact },
  { method: 'GET', path: `${CONTACTS_PATH}/:id/messages`, auth: true, handler: listContactMessages },
  { method: 'POST', path: `${CONTACTS_PATH}/:id/messages`, auth: true, handler: sendContactMessage },
  { method: 'GET', path: `${CONTACTS_PATH}/:id/mail/:mailId`, auth: true, handler: getContactMail },
  { method: 'GET', path: MAIL_IMAGE_PATH, auth: false, handler: getMailImage },
  { method: 'POST', path: `${CONTACTS_PATH}/:id/request`, auth: true, handler: decideContactRequest },
  { method: 'POST', path: `${CONTACTS_PATH}/:id/relation`, auth: true, handler: setContactRelation },
  { method: 'POST', path: `${CONTACTS_PATH}/:id/read`, auth: true, handler: readContact },
  { method: 'POST', path: `${CONTACTS_PATH}/:id/safety`, auth: true, handler: confirmContactSafety },
  { method: 'POST', path: `${CONTACTS_PATH}/:id/tasks`, auth: true, handler: createContactTask },
  { method: 'GET', path: NETWORK_PATH, auth: true, handler: getNetwork },
  { method: 'POST', path: NETWORK_JOIN_PATH, auth: true, handler: joinNetwork },
  { method: 'POST', path: NETWORK_INVITES_PATH, auth: true, handler: createNetworkInvite },
  { method: 'GET', path: NETWORK_INVITES_PATH, auth: true, handler: listNetworkInvites },
  { method: 'POST', path: NETWORK_AVATAR_PATH, auth: true, handler: setNetworkAvatar },
  { method: 'POST', path: GROUPS_PATH, auth: true, handler: createGroup },
  { method: 'POST', path: `${GROUPS_PATH}/:id`, auth: true, handler: updateGroup },
  { method: 'POST', path: `${GROUPS_PATH}/:id/leave`, auth: true, handler: leaveGroup },
  { method: 'POST', path: `${GROUP_TASKS_PATH}/:id/claim`, auth: true, handler: claimGroupTask },
  { method: 'GET', path: `${GROUP_TASKS_PATH}/:id`, auth: true, handler: getGroupTask },
  { method: 'POST', path: `${GROUP_TASKS_PATH}/:id/cancel`, auth: true, handler: cancelGroupTask },
  { method: 'GET', path: `${NETWORK_TASKS_PATH}/:id`, auth: true, handler: getNetworkTask },
  { method: 'POST', path: `${NETWORK_TASKS_PATH}/:id/decide`, auth: true, handler: decideNetworkTask },
  { method: 'POST', path: `${NETWORK_TASKS_PATH}/:id/deliver`, auth: true, handler: deliverNetworkTask },
  { method: 'POST', path: `${NETWORK_TASKS_PATH}/:id/verdict`, auth: true, handler: verdictNetworkTask },
  { method: 'POST', path: `${NETWORK_TASKS_PATH}/:id/cancel`, auth: true, handler: cancelNetworkTask },
  { method: 'POST', path: `${NETWORK_TASKS_PATH}/:id/stop`, auth: true, handler: stopNetworkTask },
  { method: 'GET', path: VISIBILITY_PATH, auth: true, handler: getVisibility },
  { method: 'POST', path: VISIBILITY_MARKS_PATH, auth: true, handler: setVisibilityMark },
  { method: 'POST', path: VISIBILITY_CONFIRM_PATH, auth: true, handler: confirmVisibility },
];
