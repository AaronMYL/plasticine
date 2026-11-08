// 截图专用假画面，明确标「模拟网站」。不访问外网，不读取真实用户数据。
import { createRoot } from 'react-dom/client';
import { App } from '../../src/app.tsx';
import { createFakeApi } from '../../src/api/fake/index.ts';
import { FakePushDevice } from '../../src/api/fake/fake-push-device.ts';
import { createClientState } from '../../src/state/context.tsx';
import { memorySink, Telemetry } from '../../src/telemetry.ts';
import type { BrowserFrame, BrowserViewport } from '../../src/api/shared.ts';

const fake = createFakeApi({ seed: false, streamStepMs: 0 });
fake.control.session.signInForDevelopment('本地截图');
fake.control.m5b.browser.seed({ open: true, available: true, activeTabId: 'tab-1', controller: 'idle',
  url: 'https://example.com/library?category=books', title: '工作室书架 · 示例网站',
  tabs: [
    { id: 'tab-1', title: '工作室书架 · 示例网站', url: 'https://example.com/library?category=books' },
    { id: 'tab-2', title: '资料索引', url: 'https://example.com/index' },
  ] });
// 一次性截图脚本把本地响应式 HTML 的真实 CDP 帧送进来；应用仍使用隔离的假 API。
const bridge = {
  viewport: null as BrowserViewport | null,
  emitFrame(frame: BrowserFrame) { fake.control.m5b.browser.emitFrame({ ...frame, tabId: 'tab-1' }); },
  controller(controller: 'idle' | 'brain') { fake.control.m5b.browser.seed({ controller }); },
};
Object.assign(window, { m6b: bridge });
const stream = fake.api.browser.stream.bind(fake.api.browser);
fake.api.browser.stream = (query, event, error) => {
  bridge.viewport = query;
  return stream(query, event, error);
};
const root = document.getElementById('root');
if (root === null) {
  throw new Error('本地截图页缺少 root');
}
createRoot(root).render(<App api={fake.api}
  state={createClientState({ storage: null })}
  telemetry={new Telemetry(memorySink([]), false)} pushDevice={new FakePushDevice()} />);
