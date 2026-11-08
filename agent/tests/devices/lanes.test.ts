import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DeviceActionParams } from '../../shared/api/index.ts';
import { classifyLane } from '../../src/devices/index.ts';

function lane(action: DeviceActionParams, purpose = '日常操作'): string {
  return classifyLane(action, purpose).lane;
}

test('关死只放付款、下单、转账：按用途、付款页面、卡号、付款入口判，读东西不会进关死', () => {
  assert.equal(lane({ kind: 'input_click', x: 10, y: 20 }, '点「立即支付」完成付款'), 'deny');
  assert.equal(lane({ kind: 'input_click', x: 10, y: 20 }, 'Click the Buy button'), 'deny');
  assert.equal(lane({ kind: 'browser_open', url: 'https://www.example.com/checkout?cart=1' }), 'deny');
  assert.equal(lane({ kind: 'browser_open', url: 'https://cashier.alipay.com/standard' }), 'deny');
  assert.equal(lane({ kind: 'input_type', text: '4111 1111 1111 1111' }, '填表'), 'deny');
  assert.equal(lane({ kind: 'run_command', cwd: '~', command: 'open "alipays://platformapi/startapp"' }), 'deny');
  assert.equal(lane({ kind: 'app_open', app: '支付宝' }, '打开支付宝给房东转账'), 'deny');
  assert.equal(lane({ kind: 'browser_read', url: 'https://www.example.com/checkout' }, '看看购买页写了什么'),
    'allow');
  assert.equal(lane({ kind: 'screen_capture' }, '截图看付款结果'), 'allow');
  assert.equal(lane({ kind: 'input_type', text: '会议改到 4 点' }, '回复邮件'), 'allow');
});

test('读钥匙串和密码、改系统设置要你点：路径、命令、应用和用途都看', () => {
  assert.equal(lane({ kind: 'file_read', path: '~/.ssh/id_ed25519' }), 'confirm');
  assert.equal(lane({ kind: 'file_read',
    path: '~/Library/Application Support/Google/Chrome/Default/Login Data' }), 'confirm');
  assert.equal(lane({ kind: 'run_command', cwd: '~', command: 'security find-generic-password -s wifi -w' }),
    'confirm');
  assert.equal(lane({ kind: 'run_command', cwd: '~', command: 'defaults write com.apple.dock autohide -bool true' }),
    'confirm');
  for (const command of ['sudo softwareupdate -l', 'tccutil reset Camera', 'spctl --master-disable',
    'systemsetup -setsleep 10', 'cat ~/.ssh/config']) {
    assert.equal(lane({ kind: 'run_command', cwd: '~', command }), 'confirm', command);
  }
  assert.equal(lane({ kind: 'app_open', app: 'System Settings' }), 'confirm');
  assert.equal(lane({ kind: 'app_open', app: 'com.apple.systempreferences' }), 'confirm');
  assert.equal(lane({ kind: 'input_click', x: 1, y: 1 }, '在系统设置里打开屏幕录制'), 'confirm');
  assert.equal(lane({ kind: 'file_read', path: '~/Documents/notes.md' }), 'allow');
  assert.equal(lane({ kind: 'run_command', cwd: '~/code', command: 'npm test' }), 'allow');
  assert.equal(lane({ kind: 'app_open', app: 'Calendar' }), 'allow');
});

test('判道的一句原因说清是哪一条、怎么放开', () => {
  const closed = classifyLane({ kind: 'input_click', x: 1, y: 1 }, '确认转账');
  assert.match(closed.reason, /关死/);
  assert.match(closed.reason, /只能在设备上改上限/);
  const tap = classifyLane({ kind: 'file_read', path: '~/.ssh/known_hosts' }, '看看');
  assert.match(tap.reason, /要你在设备上点一次授权/);
});

test('网页标签：付款页面、付款按钮、卡号和卡号框关死；读标签不会进关死', () => {
  assert.equal(lane({ kind: 'tab_open', url: 'https://cashier.alipay.com/standard' }), 'deny');
  assert.equal(lane({ kind: 'tab_navigate', tabId: 't1', url: 'https://shop.example.com/checkout' }), 'deny');
  assert.equal(lane({ kind: 'tab_click', tabId: 't1', selector: null, text: '立即支付' }), 'deny');
  assert.equal(lane({ kind: 'tab_click', tabId: 't1', selector: 'button#place-order', text: null }), 'deny');
  assert.equal(lane({ kind: 'tab_click', tabId: 't1', selector: null, text: '展开评论' }, '把购物车结账'), 'deny');
  assert.equal(lane({ kind: 'tab_fill', tabId: 't1', selector: '#note', value: '4111-1111-1111-1111' }), 'deny');
  assert.equal(lane({ kind: 'tab_fill', tabId: 't1', selector: 'input[autocomplete="cc-number"]', value: '1' }),
    'deny');
  assert.equal(lane({ kind: 'tab_read', tabId: 't1', offset: 0 }, '看看订单付款了没有'), 'allow');
  assert.equal(lane({ kind: 'tab_list' }, '看看开着哪些付款页'), 'allow');
  assert.equal(lane({ kind: 'tab_click', tabId: 't1', selector: null, text: '下一页' }, '翻到下一页'), 'allow');
  assert.equal(lane({ kind: 'tab_fill', tabId: 't1', selector: '#q', value: '杭州 天气' }, '搜天气'), 'allow');
});

test('网页标签：填密码框、用途是登录密码要你点', () => {
  assert.equal(lane({ kind: 'tab_fill', tabId: 't1', selector: 'input[type=password]', value: 'x' }), 'confirm');
  assert.equal(lane({ kind: 'tab_fill', tabId: 't1', selector: '#pwd', value: 'x' }), 'confirm');
  assert.equal(lane({ kind: 'tab_click', tabId: 't1', selector: null, text: '保存' }, '在网页上改密码'), 'confirm');
});

test('问这一页操作整页（第 3 批）：提交不在这里关死而是先问他（脚本按真实元素拦），像银行卡号的字仍然关死', () => {
  const act = (value: string): DeviceActionParams => ({ kind: 'tab_act', tabId: 't1', version: 'v1',
    act: { op: 'fill', n: 3, value }, step: '填手机号', submitAsk: null });
  const click: DeviceActionParams = { kind: 'tab_act', tabId: 't1', version: 'v1', act: { op: 'click', n: 8 },
    step: '点「提交报名并支付 ¥180」', submitAsk: null };
  assert.equal(lane(click, '报名并付款'), 'allow');
  assert.equal(lane(act('138 0000 2046'), '填报名表'), 'allow');
  assert.equal(lane(act('4111 1111 1111 1111'), '填报名表'), 'deny');
  assert.equal(lane({ kind: 'tab_perceive', tabId: 't1' }, '看看付款页'), 'allow');
});
