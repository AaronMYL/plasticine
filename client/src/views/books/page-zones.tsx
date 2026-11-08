// 翻页模式下阅读区左右两侧那两颗圆形箭头（设计稿 Reader-Paged 的 zone）：鼠标停到那一侧（约 22% 宽）才浮出来，
// 键盘 Tab 到也出来；点整条侧边都翻（use-paged.ts），箭头是给看得见、给读屏和键盘用的按钮。触屏不画（点两侧照样翻）。

import type { ReactNode } from 'react';
import { Icon } from '../../shell/icons.tsx';
import type { TurnSide } from './use-paged.ts';

export function PageZones({ hover, onTurn }: { hover: TurnSide | null; onTurn: (direction: 1 | -1) => void })
  : ReactNode {
  return (
    <>
      <button type="button" className="bk-turn bk-turn-prev" aria-label="上一页" data-shown={hover === 'prev'}
        onClick={(event) => {
          event.stopPropagation();
          onTurn(-1);
        }}>
        <Icon name="back" size={16} />
      </button>
      <button type="button" className="bk-turn bk-turn-next" aria-label="下一页" data-shown={hover === 'next'}
        onClick={(event) => {
          event.stopPropagation();
          onTurn(1);
        }}>
        <Icon name="chevron-right" size={16} />
      </button>
    </>
  );
}
