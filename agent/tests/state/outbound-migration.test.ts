import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openDatabase } from '../../src/state/db.ts';
import { createAskStore } from '../../src/state/asks.ts';
import { createProjectStore } from '../../src/state/projects.ts';
import { createScheduleStores } from '../../src/state/schedules.ts';
import { createOutboundStores } from '../../src/state/outbound.ts';
import { migrate, MIGRATIONS } from '../../src/state/migrations/index.ts';

test('Migrates legacy confirms to cron-only grants, keeping past runs unverified', () => {
  const db = openDatabase(':memory:');
  let n = 0;
  const at = '2026-11-10T00:00:00.000Z';
  const context = { db, now: () => at, newId: () => `fixture-${++n}` };
  try {
    migrate(db, MIGRATIONS.filter((entry) => entry.id < '0126'), () => at);
    const asks = createAskStore(context);
    const { schedules, scheduleSends } = createScheduleStores(context);
    const project = createProjectStore(context).create({ name: '测试项目' });
    const ask = asks.create({ kind: 'approve', purpose: 'line_question', channel: 'popup', question: '确认定时发送',
      options: [{ id: 'confirm', label: '确认', recommended: true, description: null }] });
    asks.update(ask.id, ask.version, { status: 'answered', answeredAt: at,
      answeredByDeviceId: 'fixture-device', answer: { optionId: 'confirm', label: '确认', text: null } });
    const draft = schedules.create({ title: '测试定时', goal: '发送固定内容', cadence: { type: 'daily', at: '12:00' },
      projectId: project.id, report: 'failures', place: null, replacesId: null, draftedBy: 'fixture-draft',
      outward: { channel: '测试私信', site: 'example.com', recipients: ['测试对象'],
        content: { kind: 'fixed', texts: ['固定原文'] }, contentLabel: '固定原文' } });
    schedules.update(draft.id, draft.version, { status: 'active', confirmAskId: ask.id, confirmedAt: at,
      confirmedByDeviceId: 'fixture-device' });
    scheduleSends.create({ scheduleId: draft.id, confirmAskId: ask.id, confirmedByDeviceId: 'fixture-device',
      lineId: 'fixture-line', runAt: at, toolCallId: 'fixture-call', recipient: '测试对象', content: '固定原文',
      nodeId: 'fixture-node', tabId: 'fixture-tab', pageVersion: 'v1', n: 1, op: 'click',
      pageUrl: 'https://example.com/chat' });
    const before = db.all('SELECT * FROM schedule_sends');
    assert.deepEqual(migrate(db, MIGRATIONS, () => at), ['0126-outbound-grants',
      '0127-network-attachments', '0128-mates', '0129-space-writer', '0130-memory-scope',
      '0131-video-cover', '0132-memory-cleanups', '0133-contact-links', '0134-mate-characters', '0135-prediction-loop',
        '0136-mate-looks', '0137-loop-message-predict', '0138-feed-places-body', '0139-souls',
        '0140-feed-more-images', '0141-drop-agreements',
        '0142-drop-agreement-history', '0143-drop-retired-history', '0144-mate-relays',
      '0145-wakes-watches', '0146-plans-pushes-connections',
      '0147-retired-tables-action-indexes', '0148-memory-doc-usage',
      '0149-note-private-flag-retired', '0150-model-calls']);
    const { outboundGrants, outboundLog } = createOutboundStores(context);
    const grant = outboundGrants.bySchedule(draft.id)!;
    assert.deepEqual(grant.scope, { kind: 'task', binding: { kind: 'schedule', id: draft.id } });
    assert.equal(grant.sourceAskId, ask.id);
    assert.equal(grant.confirmedByDeviceId, 'fixture-device');
    assert.equal(grant.usedCount, 1);
    assert.deepEqual(grant.fixedTexts, ['固定原文']);
    assert.equal(outboundLog.list(grant.id)[0]?.status, 'unknown');
    assert.deepEqual(db.all('SELECT * FROM schedule_sends'), before);
    assert.deepEqual(db.all('PRAGMA foreign_key_check'), []);
    assert.equal(db.get('PRAGMA integrity_check')?.integrity_check, 'ok');
    assert.deepEqual(migrate(db, MIGRATIONS, () => at), []);
  } finally { db.close(); }
});
