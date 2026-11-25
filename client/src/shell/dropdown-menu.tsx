import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { anchorOf, MenuItem, MenuSeparator, Popover, type PopoverAnchor } from './popover.tsx';
import type { IconName } from './icons.tsx';

export interface DropdownItem {
  label: string;
  onSelect: () => void;
  icon?: IconName;
  disabled?: boolean;
  shortcut?: string | undefined;
  checked?: boolean;
  danger?: boolean;
  keepOpen?: boolean;
}

export const SEPARATOR = 'separator';
export type DropdownEntry = DropdownItem | typeof SEPARATOR;

export interface DropdownMenuProps {
  label: string;
  children: ReactNode;
  items: readonly DropdownEntry[];
  className?: string;
  align?: 'start' | 'end';
  disabled?: boolean;
  tip?: string;
  keepFocus?: boolean;
  rowMenu?: boolean;
}

type Phase = { kind: 'closed' } | { kind: 'open' | 'leaving'; anchor: PopoverAnchor; keyboard: boolean };

export function DropdownMenu(props: DropdownMenuProps): ReactNode {
  const button = useRef<HTMLButtonElement>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'closed' });
  const open = phase.kind === 'open';
  const show = (keyboard: boolean): void => {
    if (button.current !== null) {
      setPhase({ kind: 'open', anchor: anchorOf(button.current), keyboard });
    }
  };
  const hide = (): void => {
    setPhase((current) => (current.kind === 'open' ? { ...current, kind: 'leaving' } : current));
  };
  const keyOnButton = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key === 'ArrowDown' && !open) {
      event.preventDefault();
      show(true);
    }
  };
  return (
    <>
      <button ref={button} type="button" className={`dropdown-trigger ${props.className ?? ''}`.trim()}
        aria-label={props.label} aria-haspopup="menu" aria-expanded={open} disabled={props.disabled}
        data-open={open ? 'true' : undefined} data-tip={props.tip}
        data-row-menu={props.rowMenu === true ? '' : undefined}
        onMouseDown={props.keepFocus === true ? (event) => event.preventDefault() : undefined}
        onKeyDown={keyOnButton}
        onClick={(event) => {
          if (open) {
            hide();
          } else {
            show(event.detail === 0);
          }
        }}>
        {props.children}
      </button>
      {phase.kind === 'closed' ? null : (
        <Popover anchor={phase.anchor} label={props.label} role="menu" align={props.align ?? 'start'}
          className="dropdown-menu" trigger={button} initialFocus={phase.keyboard ? 'first' : 'panel'}
          leaving={phase.kind === 'leaving'} onLeft={() => setPhase({ kind: 'closed' })} onClose={hide}>
          {props.items.map((item, index) => item === SEPARATOR ? <MenuSeparator key={`separator-${index}`} /> : (
            <MenuItem key={item.label} label={item.label} icon={item.icon} disabled={item.disabled === true}
              shortcut={item.shortcut} checked={item.checked} danger={item.danger} onSelect={() => {
                item.onSelect();
                if (item.keepOpen !== true) hide();
              }} />
          ))}
        </Popover>
      )}
    </>
  );
}
