// 编辑队友里挑头像（11-13 设计稿）：全部角色按引擎的家族分组，用选中的颜色画，点一个就换。读屏念角色的中文名，
// 不加悬停提示（角色一看就认得）。

import type { ReactNode } from 'react';
import type { MateCharacter, ProjectHue } from '../../../api/shared.ts';
import { isMateCharacter } from '../../../api/shared.ts';
import { useBotEngine } from './bot-engine.ts';
import { stillSvg } from './bot-render.ts';
import { CHARACTER_NAMES } from './character-names.ts';

export function CharacterPicker({ value, hue, onChange }: { value: MateCharacter; hue: ProjectHue;
  onChange: (character: MateCharacter) => void }): ReactNode {
  const engine = useBotEngine();
  return <div className="character-picker" role="group" aria-label="头像" aria-busy={engine === null}>
    {engine === null ? null : engine.SHAPE_FAMILIES.map((family) => <div key={family.id} className="character-family">
      <span className="character-family-name">{family.label.zh}</span>
      <div className="character-family-items">
        {family.shapes.filter(isMateCharacter).map((character) => (
          <button key={character} type="button" className="character-choice" aria-pressed={character === value}
            aria-label={CHARACTER_NAMES[character]}
            onClick={() => onChange(character)}>
            <span aria-hidden="true" className="character-choice-art"
              dangerouslySetInnerHTML={{ __html: stillSvg(engine, { kind: 'mate', character, hue }, 'idle', 30) }} />
          </button>
        ))}
      </div>
    </div>)}
  </div>;
}
