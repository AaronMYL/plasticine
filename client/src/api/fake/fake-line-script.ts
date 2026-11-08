// 假的线跑一轮用的剧本：思考摘要几段、几步（工具名、大白话、结果一句）、回答几段。按他说的话里的词挑一份，
// 挑不到就用一份通用的。只给本地开发和测试看样子，不模仿真的模型。

export interface ScriptStep {
  tool: string;
  say: string;
  result: string;
  ok?: boolean;
}

export interface LineScript {
  thinking: string[];
  steps: ScriptStep[];
  answer: string[];
  /** 做完这几步不往下写回答，交给调用方（出硬线卡、停在等你）。 */
  hold?: (lineId: string) => void;
}

/** 把一段话切成几段增量，看得出一段段长出来。 */
export function pieces(text: string, size = 12): string[] {
  const out: string[] = [];
  for (let index = 0; index < text.length; index += size) {
    out.push(text.slice(index, index + size));
  }
  return out;
}

const AUTOSTART: LineScript = {
  thinking: pieces('看登录项和 LaunchAgents，两处都得看。'),
  steps: [
    { tool: 'device_action', say: '在 Mac 上看登录项', result: '没有 CuaDriver' },
    { tool: 'device_action', say: '在 Mac 上读 LaunchAgents', result: 'com.trycua.driver.plist' },
  ],
  answer: pieces('会开机自启：`~/Library/LaunchAgents/com.trycua.driver.plist` 里写了 **RunAtLoad**。'
    + '不想让它自己起来，把这个文件挪走就行。'),
};

const INSTALL: LineScript = {
  thinking: pieces('先看签名和装上的时间，再对一下 Cua 的安装记录。'),
  steps: [
    { tool: 'device_action', say: '在 Mac 上读 CuaDriver 的签名', result: 'Cua AI, Inc.' },
    { tool: 'device_action', say: '在 Mac 上看它装上的时间', result: '10 月 28 日 21:14' },
    { tool: 'device_action', say: '在 Mac 上翻安装记录', result: '和 Cua 同一次装上' },
  ],
  answer: pieces('10 月 28 日 21:14 装上的，和 Cua 是同一次安装，签名是 **Cua AI, Inc.**。不是别的程序偷偷装的。'),
};

const GENERIC: LineScript = {
  thinking: pieces('先想想怎么答。'),
  steps: [],
  answer: pieces('好的，我记下了。要我接着做什么，直接说。'),
};

export function scriptFor(text: string): LineScript {
  if (text.includes('自启')) {
    return AUTOSTART;
  }
  if (text.includes('装上') || text.includes('谁装')) {
    return INSTALL;
  }
  return GENERIC;
}
