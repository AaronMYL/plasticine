import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { resourcesDir } from '../build/after-pack.ts';

const appInfo = { productFilename: 'Plasticine' };

test('Mac 的本体依赖补进 App 包里的 Resources', () => {
  const context = { appOutDir: '/out/mac-universal-x64-temp', electronPlatformName: 'darwin', packager: { appInfo } };
  assert.equal(resourcesDir(context), join('/out/mac-universal-x64-temp', 'Plasticine.app', 'Contents', 'Resources'));
});

test('Windows 和 Linux 补进安装目录的 resources', () => {
  const context = { appOutDir: '/out/win-unpacked', electronPlatformName: 'win32', packager: { appInfo } };
  assert.equal(resourcesDir(context), join('/out/win-unpacked', 'resources'));
});
