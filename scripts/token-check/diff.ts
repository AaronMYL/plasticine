// 读一份 unified diff（git diff 的输出）：每个文件改了哪些行。令牌检查器只看新增的行。

export interface DiffLine {
  /** Line number in the new file (added lines) or the old file (removed lines). */
  line: number;
  text: string;
}

export interface DiffFile {
  /** Path in the new tree (the old path for a deleted file). */
  path: string;
  added: DiffLine[];
  removed: DiffLine[];
  created: boolean;
  deleted: boolean;
}

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;
const NULL_PATH = '/dev/null';

function stripPrefix(path: string): string {
  return path.startsWith('a/') || path.startsWith('b/') ? path.slice(2) : path;
}

/** `--- a/x` / `+++ b/x` lines may carry a tab and a timestamp after the path. */
function headerPath(line: string): string {
  return line.slice(4).split('\t')[0] ?? '';
}

export function parseDiff(text: string): DiffFile[] {
  const files: DiffFile[] = [];
  let current: DiffFile | undefined;
  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;
  for (const line of text.split('\n')) {
    if (line.startsWith('diff --git ')) {
      current = { path: '', added: [], removed: [], created: false, deleted: false };
      files.push(current);
      inHunk = false;
      continue;
    }
    if (current === undefined) {
      continue;
    }
    if (!inHunk && line.startsWith('--- ')) {
      const path = headerPath(line);
      current.deleted = false;
      current.created = path === NULL_PATH;
      if (path !== NULL_PATH) {
        current.path = stripPrefix(path);
      }
      continue;
    }
    if (!inHunk && line.startsWith('+++ ')) {
      const path = headerPath(line);
      current.deleted = path === NULL_PATH;
      if (path !== NULL_PATH) {
        current.path = stripPrefix(path);
      }
      continue;
    }
    const hunk = HUNK.exec(line);
    if (hunk !== null) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      inHunk = true;
      continue;
    }
    if (!inHunk) {
      continue;
    }
    if (line.startsWith('+')) {
      current.added.push({ line: newLine, text: line.slice(1) });
      newLine += 1;
    } else if (line.startsWith('-')) {
      current.removed.push({ line: oldLine, text: line.slice(1) });
      oldLine += 1;
    } else if (line.startsWith(' ') || line === '') {
      oldLine += 1;
      newLine += 1;
    }
  }
  return files.filter((file) => file.path !== '');
}
