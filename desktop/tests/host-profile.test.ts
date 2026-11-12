import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { readHostProfile, recognizeApps } from '../src/app/host-profile.ts';

test('只认几个笔记应用，按整词比；Apple 备忘录只在 Mac 上算', () => {
  assert.deepEqual(recognizeApps(['Obsidian.app', 'Notion Calendar.app', 'Safari.app', 'Bear.app'], 'darwin'),
    ['obsidian', 'bear', 'apple-notes']);
  assert.deepEqual(recognizeApps(['Notion.lnk', '印象笔记.lnk', 'Logseq.lnk', 'Notepad.lnk'], 'win32'),
    ['notion', 'evernote', 'logseq']);
  assert.deepEqual(recognizeApps([], 'linux'), []);
});

test('Windows：从开始菜单两层里找快捷方式；目录不在就当没有', async (t) => {
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
