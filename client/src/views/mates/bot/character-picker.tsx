import type { ReactNode } from 'react';
import { isMateCharacter, type MateCharacter } from '../../../api/shared.ts';
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
