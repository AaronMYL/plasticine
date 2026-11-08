// 浏览器回归的通用入口：真实 HTTP/SSE 接口（连测试起的临时服务）、假的系统通知。
import { createRoot } from 'react-dom/client';
import { App } from '../../src/app.tsx';
import { createHttpApi } from '../../src/api/http/index.ts';
import { FakePushDevice } from '../../src/api/fake/fake-push-device.ts';
import { createClientState } from '../../src/state/context.tsx';
import { memorySink, Telemetry } from '../../src/telemetry.ts';

const root = document.getElementById('root');
if (root === null) {
  throw new Error('浏览器回归页缺少 root');
}
const state = createClientState({ storage: sessionStorage });
createRoot(root).render(<App api={createHttpApi()} state={state}
  telemetry={new Telemetry(memorySink([]), false)} pushDevice={new FakePushDevice()} />);
