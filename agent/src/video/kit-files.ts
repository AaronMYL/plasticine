// 本地转写组件下载什么（第13批，11-14 Aaron 同意的下载来源）：转写程序和 SenseVoice 模型从 k2-fsa/sherpa-onnx 的
// GitHub 发布页取，ffmpeg 用各系统的官方静态构建（eugeneware/ffmpeg-static 在 GitHub 发布页上的打包：Linux 来自
// johnvansickle.com，macOS 来自 evermeet.cx / osxexperts.net，Windows 来自 gyan.dev）。都钉死版本，按 sha256 核对，
// 对不上就不装。不进安装包，第一次解析视频时问过他再下，放进数据目录。
//
// 升级组件：改这里的版本、地址、大小和 sha256，KIT_VERSION 加一；装着旧版的会显示「没装」，再点一次安装换成新版。

/** 组件这一版的号（数据目录里 kit.json 记着；对不上就当没装）。 */
export const KIT_VERSION = 1;

export type KitUnpack =
  /** tar.bz2：只解出 members 这几项（目录连同里面的）。 */
  | { kind: 'tar.bz2'; members: readonly string[] }
  /** gz 压着的单个文件，解成 target（相对组件目录），可执行。 */
  | { kind: 'gz'; target: string }
  /** 原样放到 target。 */
  | { kind: 'file'; target: string };

export interface KitFile {
  /** 下载后在 downloads 目录里的名字。 */
  name: string;
  url: string;
  bytes: number;
  sha256: string;
  /** 解到组件目录的哪一层（tar.bz2 用）。 */
  into: string;
  unpack: KitUnpack;
}

export interface KitPlan {
  files: readonly KitFile[];
  /** 相对组件目录：转写程序、模型、VAD、词表、ffmpeg。 */
  binary: string;
  model: string;
  tokens: string;
  vad: string;
  ffmpeg: string;
}

const SHERPA = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.13.7';
const MODELS = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models';
const FFMPEG = 'https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1';
const SENSE_VOICE_DIR = 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17';

/** 各系统的转写程序：shared 版只带要用的库，二十来 MB；Windows 用 MT（自带 C 运行库，不另装 VC++）。 */
const RUNTIMES: Readonly<Record<string, { dir: string; bytes: number; sha256: string }>> = {
  'linux-x64': { dir: 'sherpa-onnx-v1.13.7-linux-x64-shared-no-tts', bytes: 24_522_109,
    sha256: 'e5abe50fae5e25ad6b70bc74b51984ccea77df2571f211833b572fcc0d1c3bef' },
  'linux-arm64': { dir: 'sherpa-onnx-v1.13.7-linux-aarch64-shared-cpu', bytes: 27_755_388,
    sha256: '7ab34c29ad9927e772f32be43efddd5e971987dc59e5f9aa3c09513348e4505b' },
  'darwin-arm64': { dir: 'sherpa-onnx-v1.13.7-osx-arm64-shared-no-tts', bytes: 18_192_670,
    sha256: '6a78081a617727ebb91a6449aaa9d98fa556272f8f7600a7c2308c9f100e2953' },
  'darwin-x64': { dir: 'sherpa-onnx-v1.13.7-osx-x64-shared-no-tts', bytes: 20_553_619,
    sha256: '27feb314449b09ea9e274f449d2b8ed26d66808c9024ef995802ca88cf5b99d0' },
  'win32-x64': { dir: 'sherpa-onnx-v1.13.7-win-x64-shared-MT-Release-no-tts', bytes: 22_932_067,
    sha256: '38a0a32c0f55752b887209a099b1c477bf350d5d9d254602a842d0610a8da831' },
};

const FFMPEGS: Readonly<Record<string, { bytes: number; sha256: string }>> = {
  'linux-x64': { bytes: 29_354_986, sha256: 'bfe8a8fc511530457b528c48d77b5737527b504a3797a9bc4866aeca69c2dffa' },
  'linux-arm64': { bytes: 25_568_691, sha256: '754a678672298bc68156adff58aa7385a592c2b30b1d0ae8750c45c915c4bac0' },
  'darwin-arm64': { bytes: 19_246_198, sha256: '8923876afa8db5585022d7860ec7e589af192f441c56793971276d450ed3bbfa' },
  'darwin-x64': { bytes: 25_296_431, sha256: '929b375c1182d956c51f7ac25e0b2b0411fb01f6f407aa15c9758efeb4242106' },
  'win32-x64': { bytes: 29_581_307, sha256: '8883a3dffbd0a16cf4ef95206ea05283f78908dbfb118f73c83f4951dcc06d77' },
};

/** 这台机器（process.platform、process.arch）要下哪几样；没有现成组件的系统是 null。 */
export function kitPlan(platform: string, arch: string): KitPlan | null {
  const key = `${platform}-${arch}`;
  const runtime = RUNTIMES[key];
  const ffmpeg = FFMPEGS[key];
  if (runtime === undefined || ffmpeg === undefined) {
    return null;
  }
  const windows = platform === 'win32';
  const exe = windows ? '.exe' : '';
  const binary = `${runtime.dir}/bin/sherpa-onnx-vad-with-offline-asr${exe}`;
  // Windows 的程序找同目录的 DLL；别的系统找 ../lib（程序里写好的 rpath）。
  const libraries = windows
    ? [`${runtime.dir}/bin/onnxruntime.dll`, `${runtime.dir}/bin/onnxruntime_providers_shared.dll`]
    : [`${runtime.dir}/lib`];
  return {
    files: [
      { name: `${runtime.dir}.tar.bz2`, url: `${SHERPA}/${runtime.dir}.tar.bz2`, bytes: runtime.bytes,
        sha256: runtime.sha256, into: 'sherpa', unpack: { kind: 'tar.bz2', members: [binary, ...libraries] } },
      { name: `${SENSE_VOICE_DIR}.tar.bz2`, url: `${MODELS}/${SENSE_VOICE_DIR}.tar.bz2`, bytes: 163_002_883,
        sha256: '7d1efa2138a65b0b488df37f8b89e3d91a60676e416f515b952358d83dfd347e', into: 'model',
        unpack: { kind: 'tar.bz2', members: [`${SENSE_VOICE_DIR}/model.int8.onnx`, `${SENSE_VOICE_DIR}/tokens.txt`] } },
      { name: 'silero_vad.onnx', url: `${MODELS}/silero_vad.onnx`, bytes: 643_854,
        sha256: '9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6', into: 'model',
        unpack: { kind: 'file', target: 'model/silero_vad.onnx' } },
      { name: `ffmpeg-${key}.gz`, url: `${FFMPEG}/ffmpeg-${key}.gz`, bytes: ffmpeg.bytes, sha256: ffmpeg.sha256,
        into: 'ffmpeg', unpack: { kind: 'gz', target: `ffmpeg/ffmpeg${exe}` } },
    ],
    binary: `sherpa/${binary}`,
    model: `model/${SENSE_VOICE_DIR}/model.int8.onnx`,
    tokens: `model/${SENSE_VOICE_DIR}/tokens.txt`,
    vad: 'model/silero_vad.onnx',
    ffmpeg: `ffmpeg/ffmpeg${exe}`,
  };
}

/** 一共要下多少字节。 */
export function kitBytes(plan: KitPlan | null): number {
  return plan === null ? 0 : plan.files.reduce((sum, file) => sum + file.bytes, 0);
}
