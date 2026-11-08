// 一个发行入口：四包公开发布并验证后，把该版本目录内的同一个 Mac ZIP 接到旧节点迁移桥。
// 工作流持锁 public → legacy；失败只记录已完成的阶段，不撤回已发的公开版，可用原产物重试。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { DEFAULT_MAC_STATE, DEFAULT_MAC_USER, publishMacUpdate, realMacPublishCommands,
  type MacPublishResult, type PublishCommands } from '../publish-mac-update.ts';
import { checkMacPackage, macPackageName } from './mac-package.ts';
import { DEFAULT_PUBLISH_ROOT, publishRelease, verifyPublishedRelease, type PublishOptions,
} from './publish-release.ts';
import { DEFAULT_RELEASE_URL, manifestUrl, parseReleaseManifest } from './release-manifest.ts';

export interface PackagesPublishOptions extends PublishOptions {
  commit: string;
  stateDirectory?: string;
  user?: string;
}

export interface PackagesReceipt {
  kind: 'plasticine_packages_release';
  schema: 1;
  status: 'complete' | 'partial' | 'failed';
  candidate: { version: string; commit: string; macSha256?: string };
  /** pending 不保证未留下版本目录，只表示这次尚未完成根 manifest 的发布。 */
  public: { status: 'pending' | 'written' | 'verified'; manifestUrl: string };
  compatibility: MacPublishResult | { status: 'not_attempted' | 'failed' };
  error?: string;
}

export class PackagesPublishError extends Error {
  readonly receipt: PackagesReceipt;
  constructor(receipt: PackagesReceipt, cause: unknown) {
    super(receipt.error, { cause });
    this.receipt = receipt;
  }
}

export async function publishPackages(input: PackagesPublishOptions,
  dependencies: { fetcher?: typeof fetch; macCommands?: PublishCommands } = {}): Promise<PackagesReceipt> {
  const receipt: PackagesReceipt = { kind: 'plasticine_packages_release', schema: 1, status: 'failed',
    candidate: { version: input.version, commit: input.commit },
    public: { status: 'pending', manifestUrl: '' }, compatibility: { status: 'not_attempted' } };
  try {
    const identity = checkMacPackage(input);
    receipt.candidate.macSha256 = identity.sha256;
    receipt.public.manifestUrl = manifestUrl(input.baseUrl).href;
    const published = publishRelease(input);
    receipt.public.status = 'written';
    await verifyPublishedRelease(published.manifest, input.baseUrl, dependencies.fetcher);
    receipt.public.status = 'verified';
    const manifest = parseReleaseManifest(readFileSync(published.manifest, 'utf8'));
    const mac = manifest.assets.mac;
    if (mac?.name !== macPackageName(input.version) || mac.sha256 !== identity.sha256 || mac.size !== identity.size) {
      throw new Error('公开清单里的 Mac 包与构建身份记录不一致，没有改兼容入口。');
    }
    receipt.compatibility = { status: 'failed' };
    receipt.compatibility = await publishMacUpdate({
      // 使用已经落盘并公开的文件；兼容端还会复核读到的字节是否仍与 catalog 相同。
      zip: join(input.root, input.version, mac.name), expectedSha256: mac.sha256,
      version: identity.appVersion, commit: input.commit,
      stateDirectory: input.stateDirectory ?? DEFAULT_MAC_STATE, user: input.user ?? DEFAULT_MAC_USER,
      now: () => input.now ?? new Date(),
      bridge: { schema: 1, releaseVersion: input.version, releaseUrl: input.baseUrl.replace(/\/$/, '') },
    }, dependencies.macCommands ?? realMacPublishCommands);
    receipt.status = 'complete';
    return receipt;
  } catch (error) {
    receipt.status = receipt.public.status === 'pending' ? 'failed' : 'partial';
    receipt.error = error instanceof Error ? error.message : String(error);
    throw new PackagesPublishError(receipt, error);
  }
}

if (import.meta.main) {
  const { values } = parseArgs({ options: {
    artifacts: { type: 'string' }, version: { type: 'string' }, commit: { type: 'string' },
    root: { type: 'string', default: DEFAULT_PUBLISH_ROOT },
    'base-url': { type: 'string', default: DEFAULT_RELEASE_URL },
  } });
  if (values.artifacts === undefined || values.version === undefined || values.commit === undefined) {
    console.error('要给 --artifacts、--version 和 --commit（完整候选 SHA）。');
    process.exitCode = 2;
  } else {
    try {
      const result = await publishPackages({ artifacts: values.artifacts, version: values.version,
        commit: values.commit, root: values.root, baseUrl: values['base-url'] });
      console.log(JSON.stringify(result));
    } catch (error) {
      if (error instanceof PackagesPublishError) console.log(JSON.stringify(error.receipt));
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  }
}
