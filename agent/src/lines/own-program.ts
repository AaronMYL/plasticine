export const OWN_PROGRAM_DIR = '/opt/plasticine';

export type OwnProgramTouch = 'program' | 'service';

export const OWN_PROGRAM_CONSEQUENCES: Readonly<Record<OwnProgramTouch, string>> = {
  program: '会改 Plasticine 自己的程序（/opt/plasticine）：改了以后跑的就不是发布的那一版，下次更新会被盖掉。',
  service: '会重启或停掉 Plasticine 自己的服务：正在做的事会断。',
};

const OWN_UNIT = String.raw`plasticine(?:-app|-update)?(?:\.service|\.timer)?(?![\w.-])`;
const UNIT_VERBS = 'restart|stop|start|kill|reload|reload-or-restart|try-restart|try-reload-or-restart|disable|'
  + 'enable|mask|unmask|edit|revert|set-property';
const SERVICE_CONTROL = [
  new RegExp(String.raw`\bsystemctl\b[^\n;]*?\b(?:${UNIT_VERBS})\b[^\n;]*?\b${OWN_UNIT}`),
  new RegExp(String.raw`\bservice\s+${OWN_UNIT}\s+(?:restart|stop|start|reload)\b`),
  /\b(?:pkill|killall)\b[^\n;]*plasticine/,
];

const MUTATORS = new RegExp(String.raw`(?:^|[\s;&|(` + '`' + String.raw`$])(?:mv|rm|rmdir|unlink|chmod|chown|chgrp|`
  + String.raw`chattr|touch|mkdir|truncate|patch|tee|dd|sed\s+(?:-\S+\s+)*-\S*i\S*|perl\s+(?:-\S+\s+)*-\S*i\S*|`
  + String.raw`git\s+(?:-C\s+\S+\s+)?(?:apply|am|checkout|restore|reset|pull|merge|stash|commit|clean|revert|`
  + String.raw`cherry-pick))(?=\s|$)`);
const COPIERS = /(?:^|[\s;&|(`$])(?:cp|install|rsync|ln|scp)(?=\s)/;
const UNPACKERS = /(?:^|[\s;&|(`$])(?:tar|unzip)(?=\s)/;
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
