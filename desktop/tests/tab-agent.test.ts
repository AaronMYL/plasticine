import assert from 'node:assert/strict';
import { test } from 'node:test';
import { shellAgent, tabUserAgent } from '../src/tabs/tab-agent.ts';

const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) '
  + 'plasticine-desktop/0.4.1 Chrome/156.0.8078.80 Electron/45.2.3 Safari/537.36';

test('web tab User-Agent strips Electron/app name and reduces Chrome version to major (156.0.0.0)', () => {
  assert.equal(tabUserAgent(MAC), 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
    + '(KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36');
  assert.equal(tabUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) '
    + 'Plasticine/0.4.1 Chrome/156.0.8078.80 Electron/45.2.3 Safari/537.36'), 'Mozilla/5.0 (Windows NT 10.0; '
    + 'Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36');
});

test('UI User-Agent strips only Electron/app name while keeping full Chrome version', () => {
  assert.equal(shellAgent(MAC), 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
    + '(KHTML, like Gecko) Chrome/156.0.8078.80 Safari/537.36');
});
