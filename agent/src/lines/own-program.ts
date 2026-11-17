// Plasticine 改自己的程序、重启自己的服务要先问他（11-17 Aaron 定「收紧」）。
// 起因：11-17 一条后台线用服务器命令把三个改过的源文件挪进 /opt/plasticine 当前那一版，再起一个临时单元把服务重启了——
// 线上跑的就不再是发布的那一版，下次更新又会被盖掉。服务器还是 Plasticine 自己的电脑（第 97 条），别的命令照旧不问；
// 只有这两样算硬线里的「权限变化」：出一张卡，他同意这一次才跑。
// 这里只看脚本的字面，是工具这一层的拦法（查、读、跑维护入口都不算）；脚本故意绕开字面就拦不住，应用账号有免密
// sudo 这件事本身没有变。

/** 安装包把程序装在这里（scripts/packages/linux/install.sh，腾讯云上也是）。 */
export const OWN_PROGRAM_DIR = '/opt/plasticine';

export type OwnProgramTouch = 'program' | 'service';

export const OWN_PROGRAM_CONSEQUENCES: Readonly<Record<OwnProgramTouch, string>> = {
  program: '会改 Plasticine 自己的程序（/opt/plasticine）：改了以后跑的就不是发布的那一版，下次更新会被盖掉。',
  service: '会重启或停掉 Plasticine 自己的服务：正在做的事会断。',
};

// 自己的服务：腾讯云上叫 plasticine-app，安装包装的叫 plasticine（plasticine-update 是它的自动更新）。
const OWN_UNIT = String.raw`plasticine(?:-app|-update)?(?:\.service|\.timer)?(?![\w.-])`;
const UNIT_VERBS = 'restart|stop|start|kill|reload|reload-or-restart|try-restart|try-reload-or-restart|disable|'
  + 'enable|mask|unmask|edit|revert|set-property';
const SERVICE_CONTROL = [
  new RegExp(String.raw`\bsystemctl\b[^\n;]*?\b(?:${UNIT_VERBS})\b[^\n;]*?\b${OWN_UNIT}`),
  new RegExp(String.raw`\bservice\s+${OWN_UNIT}\s+(?:restart|stop|start|reload)\b`),
  /\b(?:pkill|killall)\b[^\n;]*plasticine/,
];

// 一句命令里出现这些就是在改东西（前面可以有 sudo）。
const MUTATORS = new RegExp(String.raw`(?:^|[\s;&|(` + '`' + String.raw`$])(?:mv|rm|rmdir|unlink|chmod|chown|chgrp|`
  + String.raw`chattr|touch|mkdir|truncate|patch|tee|dd|sed\s+(?:-\S+\s+)*-\S*i\S*|perl\s+(?:-\S+\s+)*-\S*i\S*|`
  + String.raw`git\s+(?:-C\s+\S+\s+)?(?:apply|am|checkout|restore|reset|pull|merge|stash|commit|clean|revert|`
  + String.raw`cherry-pick))(?=\s|$)`);
// 这几样看最后一个参数（往哪放）：从程序目录往外拷不算改。
const COPIERS = /(?:^|[\s;&|(`$])(?:cp|install|rsync|ln|scp)(?=\s)/;
const UNPACKERS = /(?:^|[\s;&|(`$])(?:tar|unzip)(?=\s)/;
// 用 Python、Node 一类直接写文件。
const INTERPRETER_WRITES = new RegExp([
  String.raw`open\([^)\n]*,\s*['"][wax]`, 'write_text', 'write_bytes', 'writeFile', 'appendFile',
  String.raw`fs\.rename`, String.raw`fs\.rm`, String.raw`shutil\.(?:move|copy|rmtree)`,
  String.raw`os\.(?:rename|remove|replace|unlink)`,
].join('|'));

function escaped(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

function unquoted(token: string): string {
  return token.replace(/^['"]+|['"]+$/g, '');
}

function statementTouches(statement: string, root: string, inside: boolean): boolean {
  const mentions = statement.includes(root);
  if (new RegExp(String.raw`>{1,2}\s*['"]?${escaped(root)}`).test(statement)) {
    return true;
  }
  if (!mentions && !inside) {
    return false;
  }
  if (MUTATORS.test(statement)) {
    return true;
  }
  const tokens = statement.trim().split(/\s+/).map(unquoted);
  if (COPIERS.test(statement)) {
    const target = tokens.at(-1) ?? '';
    const flagged = tokens.some((token, index) => (token === '-t' && (tokens[index + 1] ?? '').startsWith(root))
      || token.startsWith(`--target-directory=${root}`));
    return inside || target.startsWith(root) || flagged;
  }
  if (UNPACKERS.test(statement)) {
    const flagged = tokens.some((token, index) => ((token === '-C' || token === '-d')
      && (tokens[index + 1] ?? '').startsWith(root)) || token.startsWith(`--directory=${root}`));
    return inside || flagged;
  }
  return false;
}

/**
 * 这段在本机跑的脚本会不会改 Plasticine 自己的程序目录，或者重启、停掉它自己的服务。都不会是 null。
 * cwd 是工具参数里的工作目录；root 测试时换成别的目录。
 */
export function ownProgramTouch(script: string, cwd?: string, root: string = OWN_PROGRAM_DIR): OwnProgramTouch | null {
  if (SERVICE_CONTROL.some((pattern) => pattern.test(script))) {
    return 'service';
  }
  let inside = cwd !== undefined && (cwd === root || cwd.startsWith(`${root}/`));
  const enters = new RegExp(String.raw`(?:^|[\s;&|(])cd\s+['"]?${escaped(root)}(?=[/\s'";&|)]|$)`);
  if (!inside && !script.includes(root)) {
    return null;
  }
  if (INTERPRETER_WRITES.test(script)) {
    return 'program';
  }
  for (const statement of script.split(/\n|;|&&|\|\|/)) {
    if (enters.test(statement)) {
      inside = true;
    }
    if (statementTouches(statement, root, inside)) {
      return 'program';
    }
  }
  return null;
}
