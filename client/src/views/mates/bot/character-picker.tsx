// 编辑队友里挑角色（11-13 设计稿）：全部角色按引擎的家族分组，用这位队友现在的颜色、画风、脸型画，点一个就换。
// 读屏念角色的中文名，不加悬停提示（角色一看就认得）。

import type { ReactNode } from 'react';
import type { MateCharacter } from '../../../api/shared.ts';
import { isMateCharacter } from '../../../api/shared.ts';
import { useBotEngine } from './bot-engine.ts';
import { stillSvg, type BotLook } from './bot-render.ts';
import { CHARACTER_NAMES } from './character-names.ts';

export function CharacterPicker({ value, look, onChange }: { value: MateCharacter;
  look: Extract<BotLook, { kind: 'mate' }>; onChange: (character: MateCharacter) => void }): ReactNode {
  const engine = useBotEngine();
  return <div className="character-picker" role="group" aria-label="角色" aria-busy={engine === null}>
    {engine === null ? null : engine.SHAPE_FAMILIES.map((family) => <div key={family.id} className="character-family">
      <span className="character-family-name">{family.label.zh}</span>
      <div className="character-family-items">
        {family.shapes.filter(isMateCharacter).map((character) => (
          <button key={character} type="button" className="character-choice" aria-pressed={character === value}
            aria-label={CHARACTER_NAMES[character]}
            onClick={() => onChange(character)}>
            <span aria-hidden="true" className="character-choice-art"
              dangerouslySetInnerHTML={{ __html: stillSvg(engine, { ...look, character }, 'idle', 30) }} />
          </button>
        ))}
      </div>
    </div>)}
  </div>;
}
