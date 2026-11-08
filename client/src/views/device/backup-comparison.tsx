import type { ReactNode } from 'react';
import { backupFieldLabel, backupFieldValue } from './backup-labels.ts';

function readable(text: string, kind: string): string {
  if (kind === 'note') {
    return text;
  }
  try {
    const fields: unknown = JSON.parse(text);
    if (fields === null || typeof fields !== 'object' || Array.isArray(fields)) {
      return text;
    }
    return Object.entries(fields)
      .map(([key, value]) => {
        if (value !== null && typeof value === 'object') {
          return `${backupFieldLabel(key)}\n${readable(JSON.stringify(value), kind)}`;
        }
        return `${backupFieldLabel(key)}：${backupFieldValue(key, value)}`;
      })
      .join('\n');
  } catch {
    // 旧预览可能在字段中间截断，提示重新生成，不把内部字段原文展示出来。
    return '预览内容不完整，请返回备份列表重新生成预览。';
  }
}

export function BackupComparison({
  before,
  after,
  kind,
}: {
  before: string;
  after: string;
  kind: string;
}): ReactNode {
  const left = readable(before, kind).split('\n');
  const right = readable(after, kind).split('\n');
  let start = 0;
  while (start < Math.min(left.length, right.length) && left[start] === right[start]) {
    start += 1;
  }
  let end = 0;
  while (
    end < Math.min(left.length, right.length) - start &&
    left[left.length - 1 - end] === right[right.length - 1 - end]
  ) {
    end += 1;
  }
  return (
    <div className="backup-comparison">
      {[
        { label: '现在', lines: left },
        { label: '备份', lines: right },
      ].map(({ label, lines }) => {
        const changed = lines.slice(start, lines.length - end).join('\n');
        return (
          <section key={label} aria-label={label}>
            <h4 className="block-title">{label}</h4>
            {start === 0 ? null : (
              <details>
                <summary>前面相同的内容</summary>
                <pre>{lines.slice(0, start).join('\n')}</pre>
              </details>
            )}
            <details open={before !== after}>
              <summary>{before === after ? '内容相同' : '差异内容'}</summary>
              <pre>{changed || '（此处没有内容）'}</pre>
            </details>
            {end === 0 ? null : (
              <details>
                <summary>后面相同的内容</summary>
                <pre>{lines.slice(-end).join('\n')}</pre>
              </details>
            )}
          </section>
        );
      })}
    </div>
  );
}
