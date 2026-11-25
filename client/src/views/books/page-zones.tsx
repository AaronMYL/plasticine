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
