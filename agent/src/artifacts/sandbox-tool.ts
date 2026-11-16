// sandbox_run（11-16 能力总表「跑代码」「数据分析」）：在一个碰不到正式服务的沙盒里跑一段 Python 或 Node：算数据、
// 处理表格和图片、批量改文件。文件页里的文件带进去放在 in/，代码写到 out/ 的文件存回文件页。沙盒怎么起由 app/ 接上
// （cloud-tools/sandbox.ts）；这里只管参数、带文件进出和回什么。

import { Type } from 'typebox';
import { checkedArgs, type KernelTool } from '../lines/index.ts';
import { ArtifactError } from './errors.ts';
import { saveFile } from './file-tools.ts';
import { checkUpload } from './file-types.ts';
import type { Workspace } from './workspace.ts';

export interface SandboxRun {
  language: 'python' | 'node';
  code: string;
  files: { name: string; data: Buffer }[];
  timeoutSeconds: number;
}

export interface SandboxToolParts {
  workspace: Workspace;
  available(): boolean;
  run(request: SandboxRun, signal: AbortSignal): Promise<{ exitCode: number | null; timedOut: boolean;
    stdout: string; stderr: string; outputs: { name: string; data: Buffer }[]; skipped: string[] }>;
  now(): Date;
}

/** 带进沙盒的文件一共最多这么大。 */
const INPUT_MAX_BYTES = 50 * 1024 * 1024;
/** 输出回给模型的最多这么长（再长的让代码写进 out/ 的文件）。 */
const REPLY_OUTPUT_MAX = 12_000;

const Parameters = Type.Object({
  language: Type.Union([Type.Literal('python'), Type.Literal('node')]),
  code: Type.String({ minLength: 1, maxLength: 200_000,
    description: 'Python 3.12 或 Node 24 的代码（ES module）。带进来的文件在 in/ 下，要拿回去的写到 out/。' }),
  files: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 1_000 }), { maxItems: 20, uniqueItems: true,
    description: '文件页里要带进去的文件（放在 in/<文件名>）。' })),
  saveTo: Type.Optional(Type.String({ minLength: 1, maxLength: 500,
    description: 'out/ 里的文件存到文件页的哪个文件夹（默认「沙盒/<时间>」）。' })),
  timeoutSeconds: Type.Optional(Type.Integer({ minimum: 1, maximum: 600, description: '最多跑多久，默认 60 秒。' })),
}, { additionalProperties: false });

function clip(text: string): string {
  return text.length <= REPLY_OUTPUT_MAX ? text : `${text.slice(0, REPLY_OUTPUT_MAX)}…（后面还有 ${text.length
    - REPLY_OUTPUT_MAX} 字，没放出来）`;
}

function stamp(at: Date): string {
  return at.toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-');
}

export function sandboxTool(parts: SandboxToolParts): KernelTool {
  return {
    name: 'sandbox_run',
    say: (args) => (args['language'] === 'node' ? '在沙盒里跑 Node' : '在沙盒里跑 Python'),
    hardLine: () => null,
    create: () => ({
      name: 'sandbox_run', label: '在沙盒里跑代码',
      description: '在一个碰不到正式服务的沙盒里跑一段 Python 3.12 或 Node 24：算数据、统计、处理文件。只有标准库'
        + '（没有 pandas、openpyxl；Excel 先用 file_convert 转成 CSV 带进来，出图表用 show_widgets 或写成 SVG）。'
        + '文件页里的文件用 files 带进 in/，写到 out/ 的存回文件页。连得上公网，连不上本机和内网；内存 1 GB。',
      parameters: Parameters,
      async execute(_callId, input, signal) {
        const args = checkedArgs(Parameters, input, 'sandbox_run');
        if (!parts.available()) {
          throw new ArtifactError('invalid_input', '这台 Plasticine 没有沙盒（要装在 Linux 服务器上）：简单的算数直接算，'
            + '要跑命令用 server_exec。');
        }
        const files = (args.files ?? []).map((path) => {
          const { data, entry } = parts.workspace.read(path);
          return { name: entry.name, data };
        });
        if (files.reduce((sum, file) => sum + file.data.length, 0) > INPUT_MAX_BYTES) {
          throw new ArtifactError('too_large', '带进沙盒的文件一共超过 50 MB：少带几个。', 'files');
        }
        const result = await parts.run({ language: args.language, code: args.code, files,
          timeoutSeconds: args.timeoutSeconds ?? 60 }, signal ?? new AbortController().signal);
        const folder = args.saveTo ?? `沙盒/${stamp(parts.now())}`;
        const saved: string[] = [];
        const skipped = [...result.skipped];
        for (const output of result.outputs) {
          try {
            checkUpload(output.name, output.data);
            saved.push(saveFile(parts.workspace, `${folder}/${output.name}`, output.data, true).entry.path);
          } catch (cause) {
            if (!(cause instanceof ArtifactError)) throw cause;
            skipped.push(`${output.name}（${cause.message}）`);
          }
        }
        return { content: [{ type: 'text', text: JSON.stringify({ exitCode: result.exitCode, timedOut: result.timedOut,
          stdout: clip(result.stdout), stderr: clip(result.stderr), saved,
          ...(skipped.length === 0 ? {} : { skipped }) }) }], details: {} };
      },
    }),
  };
}
