import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { readHostProfile, recognizeApps } from '../src/app/host-profile.ts';

test('matches known note apps by whole word and counts Apple Notes only on Mac', () => {
  assert.deepEqual(recognizeApps(['Obsidian.app', 'Notion Calendar.app', 'Safari.app', 'Bear.app'], 'darwin'),
    ['obsidian', 'bear', 'apple-notes']);
  assert.deepEqual(recognizeApps(['Notion.lnk', '印象笔记.lnk', 'Logseq.lnk', 'Notepad.lnk'], 'win32'),
    ['notion', 'evernote', 'logseq']);
  assert.deepEqual(recognizeApps([], 'linux'), []);
});

test('Windows scans 2 levels of Start Menu shortcuts and treats missing directory as none', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'plasticine-profile-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const programs = join(root, 'data', 'Microsoft', 'Windows', 'Start Menu', 'Programs');
  mkdirSync(join(programs, 'Obsidian'), { recursive: true });
  writeFileSync(join(programs, 'Obsidian', 'Obsidian.lnk'), '');
  writeFileSync(join(programs, 'Notion.lnk'), '');
  const profile = await readHostProfile('win32', { ProgramData: join(root, 'data'), APPDATA: join(root, 'missing') },
    root);
  assert.deepEqual(profile.apps, ['obsidian', 'notion']);
  assert.ok(profile.fullName === null || profile.fullName.length > 0);
});
