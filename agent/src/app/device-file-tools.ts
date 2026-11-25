import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import { Type, type TSchema } from 'typebox';
import { conversationMime } from '../../shared/attachments.ts';
import { DEVICE_FILE_MAX_BYTES, TAB_UPLOAD_FILES_MAX } from '../../shared/api/index.ts';
import { NODE_ACTION_PURPOSE_MAX_CHARS } from '../../shared/state.ts';
import { saveFile, type Workspace } from '../artifacts/index.ts';
import { checkedArgs, type KernelTool, type LineScope, type ToolArgs } from '../lines/index.ts';

const NodeId = Type.String({ minLength: 1, description: 'The paired node (device service) to run it on' });
const Purpose = Type.String({ minLength: 2, maxLength: NODE_ACTION_PURPOSE_MAX_CHARS,
  description: '这一步为了什么，一句他看得懂的中文（写清哪个文件传到哪里）' });
const WorkspacePath = Type.String({ minLength: 1, maxLength: 1_000 });
const DevicePath = Type.String({ minLength: 1, maxLength: 1_000 });

const UploadParameters = Type.Object({
  nodeId: NodeId, purpose: Purpose,
  tabId: Type.String({ minLength: 1, maxLength: 100 }),
  version: Type.String({ minLength: 1, maxLength: 40, description: 'tab_perceive 回的那一版' }),
  n: Type.Integer({ minimum: 1, description: '上传框或「上传」按钮的编号' }),
  paths: Type.Array(WorkspacePath, { minItems: 1, maxItems: TAB_UPLOAD_FILES_MAX, uniqueItems: true }),
}, { additionalProperties: false });

const PutParameters = Type.Object({
  nodeId: NodeId, purpose: Purpose,
  from: Type.String({ minLength: 1, maxLength: 1_000, description: '文件页里的路径' }),
  to: Type.String({ minLength: 1, maxLength: 1_000, description: '设备上的完整路径（含文件名，在授权的文件夹里）' }),
  overwrite: Type.Optional(Type.Boolean({ description: '设备上已有同名的时换掉（旧的进废纸篓）' })),
}, { additionalProperties: false });

const GetParameters = Type.Object({
  nodeId: NodeId, purpose: Purpose,
  path: DevicePath,
  saveTo: Type.String({ minLength: 1, maxLength: 1_000, description: '存进文件页的位置，含文件名' }),
  overwrite: Type.Optional(Type.Boolean({ description: '文件页里已有同名的时换掉（旧的进最近删除）' })),
}, { additionalProperties: false });

type Run = (scope: LineScope, callId: string, args: ToolArgs, signal: AbortSignal | undefined)
  => Promise<AgentToolResult<unknown>>;

function wrapper<T extends TSchema>(deviceAction: KernelTool, spec: { name: string; label: string;
  description: string; parameters: T; say(args: ToolArgs): string;
  run(args: ReturnType<typeof checkedArgs<T>>, scope: LineScope, callId: string, signal: AbortSignal | undefined,
    viaDevice: Run): Promise<AgentToolResult<unknown>> }): KernelTool {
  const viaDevice: Run = (scope, callId, args, signal) => deviceAction.create(scope).execute(callId, args, signal);
  return {
    name: spec.name,
    say: spec.say,
    hardLine: () => null,
    ...(deviceAction.enabled === undefined ? {} : { enabled: deviceAction.enabled }),
    create: (scope): AgentTool => {
      const inner = deviceAction.create(scope);
      return { ...inner, name: spec.name, label: spec.label, description: spec.description, parameters: spec.parameters,
        async execute(callId, input, signal) {
          return spec.run(checkedArgs(spec.parameters, input, spec.name), scope, callId, signal, viaDevice);
        } };
    },
  };
}

function readFiles(workspace: Workspace, paths: readonly string[]) {
  let total = 0;
  return paths.map((path) => {
    const { data, entry } = workspace.read(path);
    total += data.length;
    if (total > DEVICE_FILE_MAX_BYTES) {
      throw new Error(`文件加起来超过 ${DEVICE_FILE_MAX_BYTES / 1024 / 1024} MB，分几次传。`);
    }
    if (data.length === 0) {
      throw new Error(`「${entry.name}」是空文件。`);
    }
    return { name: entry.name, mimeType: conversationMime(entry.type ?? '', entry.name),
      base64: data.toString('base64') };
  });
}

export function deviceFileTools(deviceAction: KernelTool, workspace: Workspace,
  deviceFile: (actionId: string) => Buffer): KernelTool[] {
  const upload = wrapper(deviceAction, {
    name: 'tab_upload', label: '往网页上传文件', parameters: UploadParameters,
    description: '把文件页里的文件放进 Mac 网页标签上编号 n 的上传框（或点了会弹「选择文件」的上传按钮），不弹系统窗口。'
      + '先 tab_perceive 拿编号和 version；文件不在文件页的先用 file_save 或 device_file_get 存进去。只传这件事要用的文件；'
      + '证件、银行卡照片会先问他。传完多半还要点页面上的「上传」或「发送」（照旧 tab_act，提交前问他）。',
    say: (args) => `往网页传 ${Array.isArray(args['paths']) ? args['paths'].length : 1} 个文件`,
    run: (args, scope, callId, signal, viaDevice) => viaDevice(scope, callId, { nodeId: args.nodeId,
      purpose: args.purpose, action: { kind: 'tab_upload', tabId: args.tabId, version: args.version, n: args.n,
        files: readFiles(workspace, args.paths) } }, signal),
  });
  const put = wrapper(deviceAction, {
    name: 'device_file_put', label: '把文件放到设备上', parameters: PutParameters,
    description: '把文件页里的一份文件放到设备上（授权的文件夹里）：生成的表、下载的发票放到他桌面。已有同名的要 overwrite。',
    say: (args) => `把「${String(args['from'] ?? '')}」放到设备上`,
    run: (args, scope, callId, signal, viaDevice) => {
      const [file] = readFiles(workspace, [args.from]);
      return viaDevice(scope, callId, { nodeId: args.nodeId, purpose: args.purpose, action: { kind: 'file_put',
        path: args.to, base64: file?.base64 ?? '', overwrite: args.overwrite ?? false } }, signal);
    },
  });
  const get = wrapper(deviceAction, {
    name: 'device_file_get', label: '把设备上的文件拿进文件页', parameters: GetParameters,
    description: '把设备上（授权的文件夹里）的一份文件整份拿进文件页：他 Mac 上的照片拿来发帖、上传。最多 15 MB。',
    say: (args) => `把设备上的「${String(args['path'] ?? '')}」拿进文件页`,
    async run(args, scope, callId, signal, viaDevice) {
      await viaDevice(scope, callId, { nodeId: args.nodeId, purpose: args.purpose,
        action: { kind: 'file_fetch', path: args.path } }, signal);
      const data = deviceFile(`line:${scope.lineId}:${callId}`);
      const { entry, replaced } = saveFile(workspace, args.saveTo, data, args.overwrite ?? false);
      return { content: [{ type: 'text', text: JSON.stringify({ saved: entry.path, name: entry.name, bytes: entry.bytes,
        ...(replaced ? { note: '文件页里旧的那份在最近删除里。' } : {}) }) }], details: {} };
    },
  });
  return [upload, put, get];
}
