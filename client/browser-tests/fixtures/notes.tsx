import { createRoot } from 'react-dom/client';
import { App } from '../../src/app.tsx';
import { createHttpApi } from '../../src/api/http/index.ts';
import { FakePushDevice } from '../../src/api/fake/fake-push-device.ts';
import { createClientState } from '../../src/state/context.tsx';
import { memorySink, Telemetry } from '../../src/telemetry.ts';

const root = document.getElementById('root');
if (root === null) { throw new Error('笔记验收缺少 root'); }
createRoot(root).render(<App api={createHttpApi()}
  state={createClientState({ storage: sessionStorage })}
  telemetry={new Telemetry(memorySink([]), false)} pushDevice={new FakePushDevice()} />);
