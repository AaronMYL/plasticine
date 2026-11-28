import { execFile } from 'node:child_process';
import { clipboard, ClipboardItem, dialog, powerMonitor, powerSaveBlocker, shell, type BaseWindow } from 'electron';
import type { DeskPort } from '../node/desk-actions.ts';

const AWAKE_LINGER_MS = 10 * 60_000;

export class KeepAwake {
  #holders = 0;
  #blocker: number | null = null;
  #release: ReturnType<typeof setTimeout> | null = null;

  get active(): boolean {
    return this.#blocker !== null;
  }

  hold(): () => void {
    this.#holders += 1;
    if (this.#release !== null) {
      clearTimeout(this.#release);
      this.#release = null;
    }
    this.#blocker ??= powerSaveBlocker.start('prevent-app-suspension');
    let returned = false;
    return () => {
      if (returned) return;
      returned = true;
      this.#holders -= 1;
      if (this.#holders === 0) {
        this.#release = setTimeout(() => this.#stop(), AWAKE_LINGER_MS);
      }
    };
  }

  #stop(): void {
    this.#release = null;
    if (this.#blocker !== null && this.#holders === 0) {
      powerSaveBlocker.stop(this.#blocker);
      this.#blocker = null;
    }
  }
}

function openWith(app: string, target: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile('/usr/bin/open', ['-a', app, target], { timeout: 30_000 }, (error) => {
      if (error === null) resolve();
      else reject(new Error(`没用「${app}」打开：这台电脑上找不到这个应用，或者它打不开这个文件。`));
    });
  });
}

export function deskPort(options: { window: () => BaseWindow | null; awake: KeepAwake; platform: NodeJS.Platform;
  addRoot(path: string): void }): DeskPort {
  return {
    state: () => ({ idleSeconds: powerMonitor.getSystemIdleTime(),
      locked: powerMonitor.getSystemIdleState(1) === 'locked', onBattery: powerMonitor.isOnBatteryPower(),
      keptAwake: options.awake.active }),
    async clipboardRead() {
      const items = await clipboard.read();
      const rich = items.find((item) => item.types.includes('text/html'));
      const html = rich === undefined ? null : await (await rich.getType('text/html')).text();
      return { text: await clipboard.readText(), html: html === '' ? null : html };
    },
    async clipboardWrite(text, html) {
      await clipboard.write([new ClipboardItem(html === null ? { 'text/plain': text }
        : { 'text/plain': text, 'text/html': html })]);
    },
    async chooseFolder(reason) {
      const owner = options.window();
      const settings = { title: 'Plasticine 想用一个文件夹', message: reason, buttonLabel: '授权这个文件夹',
        properties: ['openDirectory' as const, 'createDirectory' as const] };
      const picked = owner === null ? await dialog.showOpenDialog(settings)
        : await dialog.showOpenDialog(owner, settings);
      return picked.canceled ? null : picked.filePaths[0] ?? null;
    },
    addRoot: (path) => options.addRoot(path),
    async open(target, app) {
      if (app !== null && options.platform === 'darwin') {
        await openWith(app, target);
        return;
      }
      if (/^https?:\/\//i.test(target)) {
        await shell.openExternal(target);
        return;
      }
      const error = await shell.openPath(target);
      if (error !== '') throw new Error(`没打开：${error}`);
    },
  };
}
