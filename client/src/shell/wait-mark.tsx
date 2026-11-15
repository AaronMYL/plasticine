// 「等你」的记号（11-14 界面统一）：强调色只做前面的点，字是正常字色；带件数写「等你 n」。
// 样式在 base.css 的「状态点」一节。

import type { ReactNode } from 'react';

export function WaitMark({ count, hidden = false }: { count?: number; hidden?: boolean }): ReactNode {
  return (
    <span className="wait-mark" aria-hidden={hidden ? 'true' : undefined}>
      <span className="dot dot-accent" aria-hidden="true" />
      {count === undefined ? '等你' : `等你 ${count}`}
    </span>
  );
}
