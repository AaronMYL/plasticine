import type { ReactNode } from 'react';
import { HARD_LINES_HEADING, HARD_LINES_NOTE, hardLines } from '../../api/shared.ts';
import { Icon } from '../../shell/icons.tsx';
import { SectionHead } from './section-head.tsx';
import { SettingRow } from './setting-row.tsx';

export function HardLinesSection(): ReactNode {
  return (
    <section className="block" aria-label={HARD_LINES_HEADING}>
      <SectionHead title={HARD_LINES_HEADING} tip={HARD_LINES_NOTE} />
      <ul className="hard-lines">
        {hardLines().map((line) => (
          <SettingRow key={line} as="li" lead={<Icon name="lock" size={14} />} name={line} />
        ))}
      </ul>
    </section>
  );
}
