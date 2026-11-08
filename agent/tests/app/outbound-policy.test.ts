import assert from 'node:assert/strict';
import { test } from 'node:test';
import { eventTextPolicy, responseTextPolicy } from '../../src/app/outbound-policy.ts';
import { cleanOutboundJson } from '../../src/outbound.ts';
import { memoryState } from '../brain/helpers.ts';
import { CLEAN_LINK_TEXT, CREDENTIAL_LINK_TEXT } from '../url-fixtures.ts';

test('工具结果即使带用户角色和笔记字段也照常清洗，不从字段名自行推断豁免', () => {
  const state = memoryState();
  try {
    const body = {
      role: 'user', content: CREDENTIAL_LINK_TEXT, markdown: CREDENTIAL_LINK_TEXT,
      current: { markdown: CREDENTIAL_LINK_TEXT },
    };
    for (const path of ['/v2/runs/run-1', '/v2/feed', '/v2/notes-extra']) {
      const policy = responseTextPolicy(path, body, state);
      assert.deepEqual(cleanOutboundJson(body, policy), {
        role: 'user', content: CLEAN_LINK_TEXT, markdown: CLEAN_LINK_TEXT,
        current: { markdown: CLEAN_LINK_TEXT },
      });
    }
    assert.equal(body.markdown, CREDENTIAL_LINK_TEXT);
  } finally {
    state.close();
  }
});

test('笔记错误响应只保留 current 的原文，错误说明和嵌套第三方内容继续清洗', () => {
  const state = memoryState();
  try {
    const body = {
      error: CREDENTIAL_LINK_TEXT,
      current: { markdown: CREDENTIAL_LINK_TEXT, extra: { markdown: CREDENTIAL_LINK_TEXT } },
    };
    const policy = responseTextPolicy('/v2/notes/note-1', body, state);
    assert.deepEqual(cleanOutboundJson(body, policy), {
      error: CLEAN_LINK_TEXT,
      current: { markdown: CREDENTIAL_LINK_TEXT, extra: { markdown: CLEAN_LINK_TEXT } },
    });
  } finally {
    state.close();
  }
});

test('笔记历史正文原样返回，版本接口的错误和其他路径仍清洗', () => {
  const state = memoryState();
  try {
    const body = { markdown: CREDENTIAL_LINK_TEXT, error: CREDENTIAL_LINK_TEXT };
    const policy = responseTextPolicy('/v2/notes/note-1/versions/1', body, state);
    assert.deepEqual(cleanOutboundJson(body, policy), {
      markdown: CREDENTIAL_LINK_TEXT, error: CLEAN_LINK_TEXT,
    });
    const other = responseTextPolicy('/v2/notes/note-1/versions-extra/1', body, state);
    assert.equal(cleanOutboundJson(body, other).markdown, CLEAN_LINK_TEXT);
  } finally {
    state.close();
  }
});

test('附件上传查回和事件保留用户文件名，错误与系统摘要继续清洗', () => {
  const state = memoryState();
  try {
    const attachment = {
      id: 'attachment-1', name: CREDENTIAL_LINK_TEXT, mimeType: 'text/plain' as const,
      bytes: 1, sha256: 'a'.repeat(64), status: 'ready' as const, truncated: false,
      error: CREDENTIAL_LINK_TEXT, summary: CREDENTIAL_LINK_TEXT, createdAt: '2026-10-28T00:00:00.000Z',
    };
    const expected = { ...attachment, error: CLEAN_LINK_TEXT, summary: CLEAN_LINK_TEXT };
    for (const path of [
      '/v2/conversation/attachments', '/v2/conversation/attachments/attachment-1',
      '/v2/conversation/attachments/requests/upload-1',
    ]) {
      assert.deepEqual(cleanOutboundJson(attachment, responseTextPolicy(path, attachment, state)), expected);
    }
    const event = { type: 'attachment_changed' as const, attachment };
    assert.deepEqual(cleanOutboundJson(event, eventTextPolicy(event, state)), { ...event, attachment: expected });
    const other = responseTextPolicy('/v2/runs/run-1', attachment, state);
    assert.equal(cleanOutboundJson(attachment, other).name, CLEAN_LINK_TEXT);
  } finally {
    state.close();
  }
});
