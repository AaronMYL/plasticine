import assert from 'node:assert/strict';
import { fauxAssistantMessage } from '@earendil-works/pi-ai';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { call, json, pair, startTestApp, type TestApp } from './helpers.ts';

const PATH = '/v2/books';
const TXT = [
  '浮生六记',
  '第一章 闺房记乐',
  '余生乾隆癸未冬十一月二十有二日，正值太平盛世，且在衣冠之家，居苏州沧浪亭畔。',
  '东坡云：“事如春梦了无痕”，苟不记之笔墨，未免有辜彼苍之厚。',
  '第二章 闲情记趣',
  '余忆童稚时，能张目对日，明察秋毫。',
].join('\n');

function upload(requestId: string, fileName: string, content: Buffer) {
  return {
    requestId,
    fileName,
    bytes: content.length,
    sha256: createHash('sha256').update(content).digest('hex'),
    content: content.toString('base64'),
  };
}

async function addBook(app: TestApp, cookie: string, text = TXT): Promise<Record<string, unknown>> {
  const reply = await call(app, 'POST', PATH, { cookie, body: upload(`book-${Date.now()}`, '浮生六记.txt',
    Buffer.from(text, 'utf8')) });
  assert.equal(reply.status, 201, JSON.stringify(reply.body));
  return json(reply)['book'] as Record<string, unknown>;
}

async function chapterText(app: TestApp, cookie: string, id: string, index: number): Promise<string> {
  const chapter = json(await call(app, 'GET', `${PATH}/${id}/chapters/${index}`, { cookie }));
  return String(chapter['html']).replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
}

test('没登录读不到图书馆', async () => {
  const app = await startTestApp([], { startTasks: false });
  try {
    assert.equal((await call(app, 'GET', PATH)).status, 401);
  } finally {
    await app.close();
  }
});

test('上传一本 TXT 进图书馆，能读章节；同一个文件再传一次回原来那本', async () => {
  const app = await startTestApp([], { startTasks: false });
  try {
    const cookie = await pair(app);
    const book = await addBook(app, cookie);
    assert.equal(book['format'], 'txt');
    assert.ok(Array.isArray(book['toc']) && book['toc'].length >= 2);
    const list = json(await call(app, 'GET', PATH, { cookie }));
    assert.deepEqual((list['books'] as Record<string, unknown>[]).map((entry) => entry['id']), [book['id']]);
    assert.match(await chapterText(app, cookie, String(book['id']), 1), /事如春梦了无痕/);
    const again = await call(app, 'POST', PATH, { cookie, body: upload('book-again-1', '副本.txt',
      Buffer.from(TXT, 'utf8')) });
    assert.equal(again.status, 200);
    assert.equal(json(again)['duplicate'], true);
    assert.equal((json(again)['book'] as Record<string, unknown>)['id'], book['id']);
  } finally {
    await app.close();
  }
});

test('摘要对不上或格式不认识时不进图书馆，并说清下一步', async () => {
  const app = await startTestApp([], { startTasks: false });
  try {
    const cookie = await pair(app);
    const body = upload('book-bad-sha', '坏.txt', Buffer.from('正文'));
    const broken = await call(app, 'POST', PATH, { cookie, body: { ...body, sha256: 'f'.repeat(64) } });
    assert.equal(broken.status, 400);
    const unknown = await call(app, 'POST', PATH, { cookie, body: upload('book-unknown', '表格.xlsx',
      Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0])) });
    assert.ok([415, 422].includes(unknown.status), String(unknown.status));
    assert.equal(typeof json(unknown)['error'], 'string');
    assert.deepEqual(json(await call(app, 'GET', PATH, { cookie }))['books'], []);
  } finally {
    await app.close();
  }
});

test('阅读进度后写的为准，书的视图带上进度和设备名', async () => {
  const app = await startTestApp([], { startTasks: false });
  try {
    const cookie = await pair(app);
    const id = String((await addBook(app, cookie))['id']);
    const first = await call(app, 'PUT', `${PATH}/${id}/progress`, { cookie,
      body: { chapter: 1, offset: 5, percent: 0.4, deviceLabel: 'iPhone' } });
    assert.equal(first.status, 200);
    await call(app, 'PUT', `${PATH}/${id}/progress`, { cookie,
      body: { chapter: 2, offset: 0, percent: 0.9, deviceLabel: 'Mac' } });
    const progress = json(await call(app, 'GET', `${PATH}/${id}`, { cookie }))['progress'] as Record<string, unknown>;
    assert.equal(progress['chapter'], 2);
    assert.equal(progress['deviceLabel'], 'Mac');
    const outside = await call(app, 'PUT', `${PATH}/${id}/progress`, { cookie,
      body: { chapter: 40, offset: 0, percent: 1, deviceLabel: 'Mac' } });
    assert.equal(outside.status, 400);
  } finally {
    await app.close();
  }
});

test('高亮和批注：新建、换颜色写批注、删除后不再列出；位置越界拒收', async () => {
  const app = await startTestApp([], { startTasks: false });
  try {
    const cookie = await pair(app);
    const id = String((await addBook(app, cookie))['id']);
    const text = await chapterText(app, cookie, id, 1);
    const quote = '事如春梦了无痕';
    const start = text.indexOf(quote);
    const created = await call(app, 'POST', `${PATH}/${id}/annotations`, { cookie, body: {
      requestId: 'annotation-1', chapter: 1, start, end: start + quote.length, quote,
      prefix: text.slice(Math.max(0, start - 8), start), suffix: text.slice(start + quote.length).slice(0, 8),
      color: 'ochre', deviceLabel: 'iPhone',
    } });
    assert.equal(created.status, 201);
    const annotation = json(created);
    const updated = await call(app, 'PUT', `${PATH}/${id}/annotations/${String(annotation['id'])}`, { cookie,
      body: { requestId: 'annotation-1-edit', version: annotation['version'], color: 'sage', note: '写下来' } });
    assert.equal(json(updated)['note'], '写下来');
    assert.equal(json(updated)['color'], 'sage');
    const book = json(await call(app, 'GET', `${PATH}/${id}`, { cookie }));
    assert.equal(book['annotationCount'], 1);
    const outside = await call(app, 'POST', `${PATH}/${id}/annotations`, { cookie, body: {
      requestId: 'annotation-2', chapter: 1, start: 0, end: 9999, quote: '越界', prefix: '', suffix: '',
      color: 'rose' } });
    assert.equal(outside.status, 400);
    await call(app, 'DELETE', `${PATH}/${id}/annotations/${String(annotation['id'])}`, { cookie,
      body: { requestId: 'annotation-1-delete' } });
    const list = json(await call(app, 'GET', `${PATH}/${id}/annotations`, { cookie }));
    assert.deepEqual(list['annotations'], []);
  } finally {
    await app.close();
  }
});

test('在书里找：返回章号、位置和前后文', async () => {
  const app = await startTestApp([], { startTasks: false });
  try {
    const cookie = await pair(app);
    const id = String((await addBook(app, cookie))['id']);
    const found = json(await call(app, 'GET', `${PATH}/${id}/search?q=${encodeURIComponent('明察秋毫')}`,
      { cookie }));
    const hits = found['hits'] as Record<string, unknown>[];
    assert.equal(hits.length, 1);
    assert.equal(hits[0]?.['match'], '明察秋毫');
    assert.equal(hits[0]?.['chapter'], 2);
  } finally {
    await app.close();
  }
});

test('对话里引用书里一段：原文对上才发，发出后归进这本书的讨论；书里没有的那段拒收', async () => {
  const app = await startTestApp();
  try {
    const cookie = await pair(app);
    const id = String((await addBook(app, cookie))['id']);
    const text = await chapterText(app, cookie, id, 1);
    const quote = '事如春梦了无痕';
    const start = text.indexOf(quote);
    const reference = { bookId: id, chapter: 1, start, end: start + quote.length, text: quote };
    const path = '/v2/lines/line-main/messages';
    const wrong = await call(app, 'POST', path, { cookie, body: {
      requestId: 'book-quote-wrong', text: '这句出自哪里？', quotes: [{ kind: 'book',
        bookReference: { ...reference, text: '别的话' } }] } });
    assert.equal(wrong.status, 409);
    app.respond([fauxAssistantMessage('出自苏轼的诗。')]);
    const sent = await call(app, 'POST', path, { cookie, body: {
      requestId: 'book-quote-ok', text: '这句出自哪里？', quotes: [{ kind: 'book', bookReference: reference }] } });
    assert.equal(sent.status, 200, JSON.stringify(sent.body));
    const deadline = Date.now() + 5000;
    let discussions: Record<string, unknown>[] = [];
    while (Date.now() < deadline) {
      discussions = json(await call(app, 'GET', `${PATH}/${id}/discussions`, { cookie }))['discussions'] as
        Record<string, unknown>[];
      if (discussions[0]?.['answer'] !== null && discussions.length > 0) {
        break;
      }
      await sleep(10);
    }
    assert.equal(discussions.length, 1);
    assert.equal(discussions[0]?.['question'], '这句出自哪里？');
    assert.equal(discussions[0]?.['chapter'], 1);
    assert.equal(discussions[0]?.['answer'], '出自苏轼的诗。');
    assert.match(String(discussions[0]?.['quoteLabel']), /《浮生六记》/);
  } finally {
    await app.close();
  }
});

test('标注导出成一篇笔记，没有标注时说清楚', async () => {
  const app = await startTestApp([], { startTasks: false });
  try {
    const cookie = await pair(app);
    const id = String((await addBook(app, cookie))['id']);
    const empty = await call(app, 'POST', `${PATH}/${id}/export`, { cookie, body: { requestId: 'export-empty' } });
    assert.equal(empty.status, 409);
    const text = await chapterText(app, cookie, id, 2);
    const quote = '明察秋毫';
    const start = text.indexOf(quote);
    await call(app, 'POST', `${PATH}/${id}/annotations`, { cookie, body: { requestId: 'export-annotation',
      chapter: 2, start, end: start + quote.length, quote, prefix: '', suffix: '', color: 'slate', note: '小时候' } });
    const exported = json(await call(app, 'POST', `${PATH}/${id}/export`, { cookie,
      body: { requestId: 'export-ok' } }));
    const note = json(await call(app, 'GET', `/v2/notes/${String(exported['noteId'])}`, { cookie }));
    assert.match(String(note['markdown']), /《浮生六记》读书笔记/);
    assert.match(String(note['markdown']), /> 明察秋毫/);
    assert.match(String(note['markdown']), /批注：小时候/);
  } finally {
    await app.close();
  }
});

test('生成大纲：先逐章归纳再合成，做完存下来；格式不对时标成失败并说原因', async () => {
  const digest = JSON.stringify({ chapters: [
    { index: 0, summary: '开头。', points: [], quotes: [] },
    { index: 1, summary: '写夫妻之乐。', points: ['为什么写'], quotes: ['事如春梦了无痕'] },
    { index: 2, summary: '童年的观察。', points: [], quotes: ['明察秋毫'] },
  ] });
  const outline = JSON.stringify({ note: '按卷归纳', parts: [
    { chapter: 1, title: '闺房记乐', summary: '夫妻之乐', points: ['为什么写'] },
    { chapter: 2, title: '闲情记趣', summary: '童年', points: [] },
  ] });
  const keyPoints = JSON.stringify({ points: [
    { text: '写下来是为了留痕', quotes: [{ chapter: 1, text: '事如春梦了无痕' }] },
    { text: '沈复很少写自己的过失', quotes: [{ chapter: 2, text: '书里没有这句' }] },
  ] });
  const app = await startTestApp([(digest), (outline), (keyPoints)],
    { startTasks: false });
  try {
    const cookie = await pair(app);
    const id = String((await addBook(app, cookie))['id']);
    const started = await call(app, 'POST', `${PATH}/${id}/insights`, { cookie,
      body: { requestId: 'outline-1', kind: 'outline' } });
    assert.equal(started.status, 202);
    assert.equal(json(started)['status'], 'generating');
    const ready = await waitInsight(app, cookie, id, 'outline');
    assert.equal((ready['outline'] as Record<string, unknown>)['note'], '按卷归纳');
    const points = await call(app, 'POST', `${PATH}/${id}/insights`, { cookie,
      body: { requestId: 'points-1', kind: 'key_points' } });
    assert.equal(points.status, 202);
    const done = await waitInsight(app, cookie, id, 'key_points');
    const list = (done['keyPoints'] as { points: Record<string, unknown>[] }).points;
    assert.equal(list[0]?.['basis'], 'quoted');
    assert.equal(list[1]?.['basis'], 'inferred');
    assert.equal(app.requests.length, 3, '大纲和重点共用一次逐章归纳');
    assert.deepEqual(app.requests.map((request) => request.purpose),
      ['book_digest', 'book_outline', 'book_key_points']);
    const dismissed = json(await call(app, 'POST', `${PATH}/${id}/insights/key_points/dismiss`, { cookie,
      body: { requestId: 'dismiss-1', pointId: 'p2' } }));
    assert.deepEqual(dismissed['dismissedPointIds'], ['p2']);
  } finally {
    await app.close();
  }
});

test('模型回答不是 JSON 时，大纲标成失败并写明原因', async () => {
  const app = await startTestApp([('我读完了，这本书很好看。')], { startTasks: false });
  try {
    const cookie = await pair(app);
    const id = String((await addBook(app, cookie))['id']);
    await call(app, 'POST', `${PATH}/${id}/insights`, { cookie, body: { requestId: 'outline-bad', kind: 'outline' } });
    const failed = await waitInsight(app, cookie, id, 'outline', 'failed');
    assert.match(String(failed['error']), /JSON/);
  } finally {
    await app.close();
  }
});

async function waitInsight(app: TestApp, cookie: string, id: string, kind: string,
  status = 'ready'): Promise<Record<string, unknown>> {
  const deadline = Date.now() + 5000;
  for (;;) {
    const view = json(await call(app, 'GET', `${PATH}/${id}/insights/${kind}`, { cookie }));
    if (view['status'] === status) {
      return view;
    }
    assert.ok(Date.now() < deadline, `应在五秒内变成 ${status}，现在是 ${String(view['status'])}`);
    await sleep(10);
  }
}

test('改书名；删了进「最近删除」能还原，标注跟着回来；同一个文件再传一次还原删掉的那本', async () => {
  const app = await startTestApp([], { startTasks: false });
  try {
    const cookie = await pair(app);
    const id = String((await addBook(app, cookie))['id']);
    const renamed = await call(app, 'PATCH', `${PATH}/${id}`, { cookie, body: { requestId: 'book-rename-1',
      title: '浮生六记（沈复）' } });
    assert.equal(renamed.status, 200);
    assert.equal(json(renamed)['title'], '浮生六记（沈复）');
    assert.equal((await call(app, 'PATCH', `${PATH}/${id}`, { cookie, body: { requestId: 'book-rename-2',
      title: '  ' } })).status, 400);
    const text = await chapterText(app, cookie, id, 1);
    const quote = '事如春梦了无痕';
    const start = text.indexOf(quote);
    const note = await call(app, 'POST', `${PATH}/${id}/annotations`, { cookie, body: { requestId: 'annotation-mark-1',
      chapter: 1, start, end: start + quote.length, quote, prefix: text.slice(Math.max(0, start - 8), start),
      suffix: text.slice(start + quote.length).slice(0, 8), color: 'ochre', deviceLabel: 'Mac' } });
    assert.equal(note.status, 201, JSON.stringify(note.body));
    await call(app, 'DELETE', `${PATH}/${id}`, { cookie, body: { requestId: 'book-delete-1' } });
    const trash = json(await call(app, 'GET', '/v2/library/trash', { cookie }))['items'] as Record<string, unknown>[];
    assert.deepEqual(trash.map((item) => [item['kind'], item['id'], item['title']]),
      [['book', id, '浮生六记（沈复）']]);
    const restored = await call(app, 'POST', `${PATH}/${id}/restore`, { cookie, body: { requestId: 'book-restore-1' } });
    assert.equal(restored.status, 200);
    assert.equal(json(restored)['annotationCount'], 1);
    await call(app, 'DELETE', `${PATH}/${id}`, { cookie, body: { requestId: 'book-delete-2' } });
    const again = await call(app, 'POST', PATH, { cookie, body: upload('book-reupload', '浮生六记.txt',
      Buffer.from(TXT, 'utf8')) });
    assert.equal(again.status, 200);
    assert.equal((json(again)['book'] as Record<string, unknown>)['id'], id);
    assert.equal(json(again)['duplicate'], true);
    assert.deepEqual(json(await call(app, 'GET', '/v2/library/trash', { cookie }))['items'], []);
    assert.equal((await call(app, 'POST', `${PATH}/nope/restore`, { cookie, body: { requestId: 'book-restore-2' } })).status,
      404);
  } finally {
    await app.close();
  }
});

test('图书文件夹可单独通过现有更新接口修改，标题和正文保持', async () => {
  const app = await startTestApp([], { startTasks: false });
  try {
    const cookie = await pair(app);
    const book = await addBook(app, cookie);
    const saved = await call(app, 'PATCH', `${PATH}/${String(book['id'])}`, { cookie,
      body: { requestId: 'move-book-metadata', folder: '阅读' } });
    assert.equal(saved.status, 200);
    assert.equal(json(saved)['folder'], '阅读');
    assert.equal(json(saved)['title'], book['title']);
    const read = json(await call(app, 'GET', `${PATH}/${String(book['id'])}`, { cookie }));
    assert.equal(read['folder'], '阅读');
  } finally { await app.close(); }
});
