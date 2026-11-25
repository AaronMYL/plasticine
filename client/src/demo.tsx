import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { FakePushDevice } from './api/fake/fake-push-device.ts';
import { createFakeApi } from './api/fake/index.ts';
import { App } from './app.tsx';
import { seedMediaScene } from './demo/media-seed.ts';
import { NEXT_SCRIPT, SCENES } from './demo/scenes.ts';
import { seedTeamScene } from './api/fake/team-scene-seed.ts';
import { Missed, setPaused, Stopped, type Stage } from './demo/stage.ts';
import { createClientState } from './state/context.tsx';
import { memorySink, Telemetry } from './telemetry.ts';
import './demo/demo.css';

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return { get length() { return map.size; }, clear: () => map.clear(), getItem: (key) => map.get(key) ?? null,
    key: (index) => [...map.keys()][index] ?? null, removeItem: (key) => { map.delete(key); },
    setItem: (key, value) => { map.set(key, String(value)); } };
}
for (const name of ['localStorage', 'sessionStorage'] as const) {
  try {
    window[name].getItem('plasticine.probe');
  } catch {
    Object.defineProperty(window, name, { value: memoryStorage(), configurable: true });
  }
}
window.localStorage.setItem('plasticine.appearance', 'dark');

const fake = createFakeApi({ seed: true, streamStepMs: 60 });
void seedTeamScene(fake.control, new Date());
void seedMediaScene(fake.control, new Date());
const lines = fake.control.lines;
const send = lines.send.bind(lines);
lines.send = async (lineId, body) => {
  const response = await send(lineId, body);
  const script = NEXT_SCRIPT.get(lineId);
  if (script !== undefined) {
    NEXT_SCRIPT.delete(lineId);
    lines.resumeWith(lineId, script);
  }
  return response;
};
const root = document.getElementById('root');
if (root === null) throw new Error('demo.html 里没有 #root');
createRoot(root).render(
  <StrictMode>
    <App api={fake.api} state={createClientState({ storage: null, noteCacheStorage: null })}
      telemetry={new Telemetry(memorySink([]), true)} pushDevice={new FakePushDevice()} />
  </StrictMode>,
);

let run = 0;

async function play(from: number): Promise<void> {
  const mine = ++run;
  const stage: Stage = { alive: () => mine === run };
  try {
    for (let index = from; index < SCENES.length; index += 1) {
      const scene = SCENES[index]!;
      window.parent.postMessage({ plasticineDemo: 'scene', id: scene.id }, '*');
      try {
        await scene.run(stage, fake.control);
      } catch (cause) {
        if (!(cause instanceof Missed)) throw cause;
      }
    }
    if (stage.alive()) {
      window.location.hash = '';
      window.location.reload();
    }
  } catch (cause) {
    if (!(cause instanceof Stopped)) throw cause;
  }
}

const framed = window.parent !== window;
setPaused(framed);

window.addEventListener('message', (event: MessageEvent<unknown>) => {
  const data = event.data;
  if (event.source !== window.parent || typeof data !== 'object' || data === null) return;
  if (Reflect.get(data, 'plasticineDemo') === 'run') {
    setPaused(Reflect.get(data, 'on') !== true);
    return;
  }
  if (Reflect.get(data, 'plasticineDemo') !== 'go') return;
  const index = SCENES.findIndex((scene) => scene.id === Reflect.get(data, 'id'));
  if (index >= 0) void play(index);
});

const wanted = new URLSearchParams(window.location.search).get('start');
setTimeout(() => void play(Math.max(0, SCENES.findIndex((scene) => scene.id === wanted))), 1200);
