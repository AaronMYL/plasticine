// 服务器上的几条命令（重设密码、数据迁移）读口令用：终端里不回显地读一行，脚本里从标准输入读一行。

const CTRL_C = '\u0003';
const CTRL_D = '\u0004';
const BACKSPACE = new Set(['\u007f', '\b']);

export class Cancelled extends Error {
  constructor() {
    super('取消了');
    this.name = 'Cancelled';
  }
}

/** 终端里读一行，不回显（raw 模式自己收字：回车结束、退格删一个字、Ctrl-C 取消）。 */
export function readHidden(prompt: string): Promise<string> {
  const input = process.stdin;
  process.stderr.write(prompt);
  input.setRawMode(true);
  input.setEncoding('utf8');
  input.resume();
  return new Promise((resolve, reject) => {
    let value = '';
    const finish = (error: Error | null): void => {
      input.off('data', onData);
      input.setRawMode(false);
      input.pause();
      process.stderr.write('\n');
      if (error === null) {
        resolve(value);
      } else {
        reject(error);
      }
    };
    const onData = (chunk: string): void => {
      for (const char of chunk) {
        if (char === '\r' || char === '\n') {
          finish(null);
          return;
        }
        if (char === CTRL_C || char === CTRL_D) {
          finish(new Cancelled());
          return;
        }
        if (BACKSPACE.has(char)) {
          value = Array.from(value).slice(0, -1).join('');
        } else if (char >= ' ') {
          value += char;
        }
      }
    };
    input.on('data', onData);
  });
}

export async function readLine(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8').split(/\r?\n/)[0] ?? '';
}
