import type { PreserveOutboundField } from '../outbound/index.ts';
import type { StateService } from '../state/index.ts';

type JsonObject = Record<string, unknown>;
type PreservedFields = WeakMap<object, ReadonlySet<string>>;
type TextState = Pick<StateService, 'memory' | 'apiRequests'>;

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
    fields.set(entry, new Set(['markdown', 'title', 'preview', 'folder']));
  }
}

function attachment(fields: PreservedFields, value: unknown): void {
  const entry = object(value);
  if (entry !== undefined) {
    fields.set(entry, new Set(['name']));
  }
}

function memory(fields: PreservedFields, value: unknown, state: TextState): void {
  const entry = object(value);
  if (entry === undefined || typeof entry['id'] !== 'string' || typeof entry['version'] !== 'number') {
    return;
  }
  const version = entry['version'];
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

export function responseTextPolicy(pathname: string, body: unknown, state: TextState): PreserveOutboundField {
  if (pathname === '/v2/nodes/actions/next') {
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
  } else if (/^\/v2\/conversation\/attachments\/uploads\/?$/.test(pathname)) {
    attachment(fields, root?.['attachment']);
  } else if (/^\/v2\/conversation\/attachments(?:\/(?:requests\/)?[^/]+)?(?:\/complete)?\/?$/.test(pathname)) {
    attachment(fields, root);
  } else if (/^\/v2\/memory(?:\/entries(?:\/[^/]+(?:\/archive)?)?)?\/?$/.test(pathname)) {
    memory(fields, root?.['entry'], state);
    memory(fields, root?.['current'], state);
    each(root?.['entries'], (entry) => memory(fields, entry, state));
    for (const column of ['quotes', 'interpretations']) {
      each(object(root?.[column])?.['entries'], (entry) => memory(fields, entry, state));
    }
    memoryHistory(fields, root?.['history']);
  } else if (pathname.startsWith('/v2/lines/')) {
    lineBody(fields, root);
  } else if (/^\/v2\/model-providers\/[^/]+\/login(?:\/[^/]+(?:\/(?:complete|cancel))?)?\/?$/.test(pathname)) {
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
