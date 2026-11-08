// 网站的登录（协议 agent/shared/api/mac-logins.ts）：在 Plasticine 的浏览器里登录一次就记住（网页标签共用的持久
// session 里的 Cookie，Chromium 用系统钥匙串加密存盘）；登录状态只在这台电脑上，不进本体。「导入登录…」= 从 Chrome
// 搬一次登录状态（Cookie，不导密码，第 6 条）。界面只拿到站点名、个数和结果，拿不到 Cookie 的值。
// Safari 的导入还没移植到 Electron 版：sources 里报不可用。

import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, win32 } from 'node:path';
import type { Session } from 'electron';
import type { LoginImportRequest, LoginImportResult, LoginSources, SiteLogins }
  from '../../../agent/shared/api/mac-logins.ts';
import { SITE_LOGINS_MAX } from '../../../agent/shared/api/mac-logins.ts';
import { cbcKey, ChromeImportProblem, cookieHosts, readCookies, siteOf, windowsEncryptedKey, type ChromeCookie,
  type ChromeKey } from './chrome-cookies.ts';

/** Chrome 的口令派生次数（Mac 1003；Linux 没有钥匙环时 1 次、口令 peanuts）。 */
const MAC_ROUNDS = 1003;
const SAME_SITE = ['no_restriction', 'lax', 'strict'] as const;

export interface LoginsDeps {
  session: Session;
  platform: 'darwin' | 'win32' | 'linux';
  home: string;
  localAppData: string | null;
  /** 记「什么时候导入的」的小文件。 */
  sinceFile: string;
  now(): Date;
  log(line: string): void;
}

function chromeRoot(deps: LoginsDeps): string {
  if (deps.platform === 'darwin') {
    return join(deps.home, 'Library', 'Application Support', 'Google', 'Chrome');
  }
  if (deps.platform === 'win32') {
    return win32.join(deps.localAppData ?? win32.join(deps.home, 'AppData', 'Local'), 'Google', 'Chrome', 'User Data');
  }
  return join(deps.home, '.config', 'google-chrome');
}

/** 默认个人资料里的 Cookie 库（Chrome 96 起在 Network/ 下，老版本在资料目录下）。 */
function cookieDatabase(deps: LoginsDeps): string {
  const join2 = deps.platform === 'win32' ? win32.join : join;
  const profile = join2(chromeRoot(deps), 'Default');
  const network = join2(profile, 'Network', 'Cookies');
  return existsSync(network) ? network : join2(profile, 'Cookies');
}

function macStorageSecret(): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('/usr/bin/security', ['find-generic-password', '-w', '-s', 'Chrome Safe Storage'], (error, stdout) => {
      if (error === null) {
        resolve(stdout.trim());
        return;
      }
      const code = typeof error.code === 'number' ? error.code : -1;
      reject(new ChromeImportProblem(code === 44
        ? '钥匙串里没有找到「Chrome Safe Storage」：Chrome 装过、登录过吗？'
        : '你没有允许 Plasticine 读「Chrome Safe Storage」，没有导入。'));
    });
  });
}

/** Windows：用 DPAPI 在他的账户下解开 Chrome 的钥匙（PowerShell 调 .NET 的 ProtectedData，系统自带）。 */
function dpapiUnprotect(sealed: Buffer): Promise<Buffer> {
  const script = 'Add-Type -AssemblyName System.Security; $in = [Console]::In.ReadToEnd().Trim(); '
    + '$out = [Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($in), $null, '
    + "'CurrentUser'); [Console]::Out.Write([Convert]::ToBase64String($out))";
  return new Promise((resolve, reject) => {
    const child = execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script],
      { windowsHide: true, timeout: 30_000 }, (error, stdout) => {
        if (error === null) {
          resolve(Buffer.from(stdout.trim(), 'base64'));
        } else {
          reject(new ChromeImportProblem('没能用 Windows 的 DPAPI 解开 Chrome 的钥匙，没有导入。', { cause: error }));
        }
      });
    child.stdin?.end(sealed.toString('base64'));
  });
}

function cookieUrl(cookie: ChromeCookie): string {
  return `${cookie.secure ? 'https' : 'http'}://${cookie.host.replace(/^\./, '')}${cookie.path}`;
}

export class Logins {
  private readonly deps: LoginsDeps;

  constructor(deps: LoginsDeps) {
    this.deps = deps;
  }

  async sites(): Promise<SiteLogins> {
    const since = this.since();
    const hosts = new Set((await this.deps.session.cookies.get({})).map((cookie) => siteOf(cookie.domain ?? '')));
    const sites = [...hosts].filter((host) => host !== '').sort().slice(0, SITE_LOGINS_MAX)
      .map((host) => ({ host, name: host.split('.')[0] ?? host, password: false, since: since[host] ?? null }));
    return { sites };
  }

  async sources(): Promise<LoginSources> {
    const database = cookieDatabase(this.deps);
    const available = existsSync(database);
    let sites: number | null = null;
    if (available) {
      try {
        sites = new Set(cookieHosts(database).map(siteOf)).size;
      } catch (error) {
        if (!(error instanceof ChromeImportProblem)) {
          throw error;
        }
      }
    }
    return { sources: [
      { id: 'chrome', available, profile: available ? '默认个人资料' : null, sites, needs: null, passwords: false },
      { id: 'safari', available: false, profile: null, sites: null, needs: null, passwords: false },
    ] };
  }

  async import(request: LoginImportRequest): Promise<LoginImportResult> {
    if (request.from !== 'chrome') {
      return { sites: 0, cookies: 0, passwords: 0, skipped: 0, problem: '这一版只会从 Chrome 导入。' };
    }
    try {
      const key = await this.key();
      const { cookies, skipped } = readCookies(cookieDatabase(this.deps), key, this.deps.now());
      let failed = 0;
      const sites = new Set<string>();
      for (const cookie of cookies) {
        try {
          await this.deps.session.cookies.set({ url: cookieUrl(cookie), name: cookie.name, value: cookie.value,
            path: cookie.path, secure: cookie.secure, httpOnly: cookie.httpOnly,
            ...(cookie.host.startsWith('.') ? { domain: cookie.host } : {}),
            ...(cookie.expires === null ? {} : { expirationDate: cookie.expires }),
            sameSite: SAME_SITE[cookie.sameSite] ?? 'unspecified' });
          sites.add(siteOf(cookie.host));
        } catch (error) {
          failed += 1;
          this.deps.log(`有一条 Cookie 没放进去：${error instanceof Error ? error.message : String(error)}`);
        }
      }
      await this.deps.session.cookies.flushStore();
      this.remember([...sites]);
      return { sites: sites.size, cookies: cookies.length - failed, passwords: 0, skipped: skipped + failed,
        problem: null };
    } catch (error) {
      if (error instanceof ChromeImportProblem) {
        return { sites: 0, cookies: 0, passwords: 0, skipped: 0, problem: error.message };
      }
      throw error;
    }
  }

  async forget(host: string): Promise<boolean> {
    const site = siteOf(host);
    for (const cookie of await this.deps.session.cookies.get({})) {
      if (siteOf(cookie.domain ?? '') !== site) {
        continue;
      }
      const url = `${cookie.secure === true ? 'https' : 'http'}://${(cookie.domain ?? '').replace(/^\./, '')}`
        + `${cookie.path ?? '/'}`;
      await this.deps.session.cookies.remove(url, cookie.name);
    }
    await this.deps.session.clearStorageData({ origin: `https://${site}` });
    return true;
  }

  private async key(): Promise<ChromeKey> {
    if (this.deps.platform === 'darwin') {
      return cbcKey(await macStorageSecret(), MAC_ROUNDS);
    }
    if (this.deps.platform === 'win32') {
      const localState = win32.join(chromeRoot(this.deps), 'Local State');
      if (!existsSync(localState)) {
        throw new ChromeImportProblem('这台电脑上没找到 Chrome 的 Local State：Chrome 装过、登录过吗？');
      }
      const sealed = windowsEncryptedKey(readFileSync(localState, 'utf8'));
      return { scheme: 'gcm', key: await dpapiUnprotect(sealed) };
    }
    return cbcKey('peanuts', 1);
  }

  private since(): Record<string, string> {
    try {
      return JSON.parse(readFileSync(this.deps.sinceFile, 'utf8')) as Record<string, string>;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError) {
        return {};
      }
      throw error;
    }
  }

  private remember(sites: string[]): void {
    const since = this.since();
    const now = this.deps.now().toISOString();
    for (const site of sites) {
      since[site] = now;
    }
    mkdirSync(dirname(this.deps.sinceFile), { recursive: true });
    const temporary = `${this.deps.sinceFile}.partial`;
    writeFileSync(temporary, JSON.stringify(since));
    renameSync(temporary, this.deps.sinceFile);
  }
}
