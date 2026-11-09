// 用户自己的可编辑原文只回给已认证的本人，不能在出口改写，否则编辑器读回再保存会损坏数据。
// 豁免绑定具体路由 / 事件的字段，不因任意对象带有 content、markdown 或 role 就放行。
import type { HubStreamEvent } from '../../shared/api/index.ts';
import type { PreserveOutboundField } from '../outbound.ts';
import type { StateService } from '../state/index.ts';

type JsonObject = Record<string, unknown>;
type PreservedFields = WeakMap<object, ReadonlySet<string>>;
type TextState = Pick<StateService, 'memory' | 'agreements' | 'apiRequests'>;

function object(value: unknown): JsonObject | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as JsonObject : undefined;
}

function each(value: unknown, visit: (entry: unknown) => void): void {
  if (Array.isArray(value)) {
    value.forEach(visit);
  }
}

function note(fields: PreservedFields, value: unknown): void {
  const entry = object(value);
  if (entry !== undefined) {
    // markdown 是当前正文，也是保存草稿与 409 当前版本的全文；标题、预览从正文派生。
    fields.set(entry, new Set(['markdown', 'title', 'preview', 'folder']));
  }
}

function attachment(fields: PreservedFields, value: unknown): void {
  const entry = object(value);
  if (entry !== undefined) {
    // 文件名是用户输入；上传文本的下载走原始字节响应，不经过 JSON 清洗。错误和系统摘要仍清洗。
    fields.set(entry, new Set(['name']));
  }
}

function memory(fields: PreservedFields, value: unknown, state: TextState): void {
  const entry = object(value);
  if (entry === undefined || typeof entry['id'] !== 'string' || typeof entry['version'] !== 'number') {
    return;
  }
  const version = entry['version'];
  // 回执和 SSE 可以重放旧版，必须看返回的那一版；用户只改 stale 不会豁免模型正文。
  const history = state.memory.history(entry['id']).filter((change) => change.version <= version);
  const snapshot = history.find((change) => change.version === version)?.snapshot;
  const kept = new Set<string>();
  for (const key of ['text', 'applicability']) {
    if (snapshot === undefined || snapshot[key] !== entry[key]) {
      continue;
    }
    const quote = key === 'text' && snapshot['kind'] === 'quote' && snapshot['basis'] === 'self_reported';
    if (quote || history.findLast((change) => change.fields.includes(key))?.actor === 'user') {
      kept.add(key);
    }
  }
  // 来源标签、模型来路与解释等没有一并豁免。
  fields.set(entry, kept);
}

function memoryHistory(fields: PreservedFields, value: unknown): void {
  each(value, (item) => {
    const change = object(item);
    if (change?.['actor'] === 'user') {
      fields.set(change, new Set(['reason']));
    }
  });
}

/** 错误响应仅豁免其中的 current 原文，错误说明继续清洗。 */
export function responseTextPolicy(pathname: string, body: unknown, state: TextState): PreserveOutboundField {
  if (pathname === '/v2/nodes/actions/next') {
    // 节点执行参数必须与落盘内容一致，不能把文件内容或网址当展示文案改写。
    const params = object(object(object(body)?.['action'])?.['params']);
    return (parent) => parent === params;
  }
  const lookupId = /^\/v2\/signed-requests\/([^/]+)\/?$/.exec(pathname)?.[1];
  if (lookupId !== undefined) {
    const receipt = state.apiRequests.find(decodeURIComponent(lookupId));
    if (receipt?.scope.startsWith('POST /v2/') === true) {
      return responseTextPolicy(receipt.scope.slice(5), body, state);
    }
  }
  const fields: PreservedFields = new WeakMap();
  const root = object(body);
  if (/^\/v2\/notes(?:\/[^/]+(?:\/versions(?:\/\d+)?)?)?\/?$/.test(pathname)) {
    note(fields, root);
    note(fields, root?.['current']);
    each(root?.['notes'], (entry) => note(fields, entry));
  } else if (/^\/v2\/conversation\/attachments(?:\/(?:requests\/)?[^/]+)?\/?$/.test(pathname)) {
    attachment(fields, root);
  } else if (/^\/v2\/agreements(?:\/[^/]+(?:\/(?:edit|confirm))?)?\/?$/.test(pathname)) {
    const keys = ['text', 'scope', 'userQuote'];
    userFields(fields, root?.['agreement'], state, keys);
    userFields(fields, root?.['current'], state, keys);
    each(root?.['agreements'], (value) => userFields(fields, value, state, keys));
    memoryHistory(fields, root?.['history']);
    memoryHistory(fields, root?.['lineage']);
  } else if (/^\/v2\/memory(?:\/entries(?:\/[^/]+(?:\/archive)?)?)?\/?$/.test(pathname)) {
    memory(fields, root?.['entry'], state);
    memory(fields, root?.['current'], state);
    each(root?.['entries'], (entry) => memory(fields, entry, state));
    for (const column of ['quotes', 'interpretations']) {
      each(object(root?.[column])?.['entries'], (entry) => memory(fields, entry, state));
    }
    each(object(root?.['agreements'])?.['agreements'], (value) =>
      userFields(fields, value, state, ['text', 'scope', 'userQuote']));
    memoryHistory(fields, root?.['history']);
  } else if (pathname.startsWith('/v2/lines/')) {
    lineBody(fields, root);
  } else if (/^\/v2\/model-providers\/[^/]+\/login(?:\/[^/]+(?:\/(?:complete|cancel))?)?\/?$/.test(pathname)) {
    // 订阅登录的授权网址要原样打开：redirect_uri、state、code_challenge 这些参数被清掉就登不上。网址是服务端自己拼的，
    // PKCE 的 verifier 留在服务端，不在网址里。
    if (root !== undefined) {
      fields.set(root, new Set(['url']));
      const code = object(root['deviceCode']);
      if (code !== undefined) {
        fields.set(code, new Set(['verificationUri']));
      }
    }
  } else if (/^\/v2\/bookmarks(?:\/[^/]+(?:\/(?:remove|restore))?)?\/?$/.test(pathname)) {
    bookmark(fields, root?.['bookmark']);
    bookmark(fields, root?.['current']);
    each(root?.['bookmarks'], (entry) => bookmark(fields, entry));
  }
  return (parent, key) => fields.get(parent)?.has(key) ?? false;
}

/**
 * 书签的地址是要原样打开的（第 110 条）：# 后面的定位、单页应用的路由不能在出口被裁掉。只豁免用户自己加和导入的
 * target（写入时 daily/bookmarks.ts 已经去掉了账号密码和像口令的参数）；信息流收藏来的（含迁移来的旧收藏）照旧清洗，
 * 和信息流条目上显示的一样。名字照旧清洗。
 */
function bookmark(fields: PreservedFields, value: unknown): void {
  const entry = object(value);
  if (entry === undefined || entry['origin'] === 'feed') {
    return;
  }
  fields.set(entry, new Set(['target']));
  each(entry['tabs'], (tab) => {
    const row = object(tab);
    if (row !== undefined) {
      fields.set(row, new Set(['target']));
    }
  });
}

function userFields(fields: PreservedFields, value: unknown, state: TextState, keys: string[]): void {
  const row = object(value);
  if (row === undefined || typeof row['id'] !== 'string' || typeof row['version'] !== 'number') {
    return;
  }
  const history = state.agreements.history(row['id'])
    .filter((entry) => entry.version <= Number(row['version']));
  const snapshot = history.find((entry) => entry.version === row['version'])?.snapshot;
  const kept = keys.filter((key) => snapshot?.[key] === row[key]
    && history.findLast((entry) => entry.fields.includes(key))?.actor === 'user');
  if (kept.length > 0) {
    fields.set(row, new Set([...(fields.get(row) ?? []), ...kept]));
  }
}

/** 新内核的线：用户自己说的话（线里的用户消息、排队的消息）原样回给他；回答、工具结果照旧清洗。 */
function lineMessage(fields: PreservedFields, value: unknown): void {
  const entry = object(value);
  if (entry?.['role'] === 'user') {
    fields.set(entry, new Set(['text']));
  }
}

function queuedMessage(fields: PreservedFields, value: unknown): void {
  const entry = object(value);
  if (entry !== undefined && typeof entry['status'] === 'string') {
    fields.set(entry, new Set(['text']));
  }
}

function lineBody(fields: PreservedFields, root: JsonObject | undefined): void {
  lineMessage(fields, root?.['message']);
  each(root?.['messages'], (entry) => lineMessage(fields, entry));
  queuedMessage(fields, root?.['queued']);
  queuedMessage(fields, root?.['item']);
  each(root?.['queue'], (entry) => queuedMessage(fields, entry));
}

/** 实时与重放共用同一出口；模型增量、模型消息、工具结果和信息流事件没有豁免。 */
export function eventTextPolicy(event: HubStreamEvent, state: TextState): PreserveOutboundField {
  const fields: PreservedFields = new WeakMap();
  if (event.type === 'attachment_changed') {
    attachment(fields, event.attachment);
  } else if (event.type === 'ask_answered' && event.ask.answer !== null) {
    fields.set(event.ask.answer, new Set(['text', 'label']));
  } else if (event.type === 'memory_entry_changed') {
    memory(fields, event.entry, state);
  } else if (event.type === 'agreement_changed') {
    userFields(fields, event.agreement, state, ['text', 'scope', 'userQuote']);
  } else if (event.type === 'line_message' || event.type === 'line_queue') {
    lineBody(fields, object(event));
  }
  return (parent, key) => fields.get(parent)?.has(key) ?? false;
}
