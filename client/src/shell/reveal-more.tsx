import { Fragment, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { IconButton } from './icon-button.tsx';
import type { IconName } from './icons.tsx';
import { anchorOf, MenuItem, MenuSeparator, Popover, type PopoverAnchor } from './popover.tsx';

export interface RevealAction {
  icon: IconName;
  label: string;
  onSelect: (anchor: PopoverAnchor) => void;
  disabled?: boolean | undefined;
  danger?: boolean | undefined;
}

export interface RevealMoreProps {
  label: string;
  actions?: readonly RevealAction[];
}

const ROW = 'li, [role="listitem"], [role="row"], .column-row, tr';

export function RevealMore({ label, actions = [] }: RevealMoreProps): ReactNode {
  const button = useRef<HTMLButtonElement>(null);
  const [menu, setMenu] = useState<PopoverAnchor | null>(null);
  const hasActions = actions.length > 0;
  useLayoutEffect(() => {
    const row = hasActions ? button.current?.closest(ROW) ?? null : null;
    if (row === null || row.hasAttribute('data-context-row')) return undefined;
    row.setAttribute('data-context-row', '');
    return () => row.removeAttribute('data-context-row');
  }, [hasActions]);
  if (actions.length === 0) {
    return <span className="reveal-more reveal-more-slot" aria-hidden="true" />;
  }
  const close = (): void => setMenu(null);
  const click = (): void => {
    if (menu !== null) {
      close();
    } else if (button.current !== null) {
      setMenu(anchorOf(button.current));
    }
  };
  return (
    <>
      <IconButton ref={button} icon="more" className="reveal-more" label={label} title="更多" data-row-menu=""
        aria-haspopup="menu" aria-expanded={menu !== null} onClick={click} />
      {menu === null ? null : (
        <Popover anchor={menu} label={label} role="menu" align="end" trigger={button} onClose={close}>
          <ActionItems actions={actions} anchor={menu} onClose={close} />
        </Popover>
      )}
    </>
  );
}

export function ActionItems({ actions, anchor, onClose }: { actions: readonly RevealAction[]; anchor: PopoverAnchor;
  onClose: () => void }): ReactNode {
  return actions.map((action, index) => (
    <Fragment key={action.label}>
      {action.danger === true && index > 0 ? <MenuSeparator /> : null}
      <MenuItem icon={action.icon} label={action.label} disabled={action.disabled === true}
        danger={action.danger}
        onSelect={() => {
          onClose();
          action.onSelect(anchor);
        }} />
    </Fragment>
  ));
}
