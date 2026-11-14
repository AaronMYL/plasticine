// 编辑队友里挑头像（11-13 设计稿）：「角色 · 画风 · 脸型」三选一切换下面同一块格子，格子里都是这位队友换上那一项的
// 样子；颜色一直在格子下面（mate-editor.tsx）。主线只换画风，用 LookChoices。

import { useState, type ReactNode } from 'react';
import { MATE_FACES, MATE_VARIANTS, type MateCharacter, type MateFace, type MateVariant,
  type ProjectHue } from '../../../api/shared.ts';
import { useBotEngine } from './bot-engine.ts';
import { stillSvg, type BotLook } from './bot-render.ts';
import { CharacterPicker } from './character-picker.tsx';
import { FACE_NAMES, VARIANT_NAMES } from './look-names.ts';

export type MateLookDraft = { avatar: MateCharacter; hue: ProjectHue; variant: MateVariant; face: MateFace };
type Tab = 'character' | 'variant' | 'face';
const TABS: readonly (readonly [Tab, string])[] = [['character', '角色'], ['variant', '画风'], ['face', '脸型']];

export function LookPicker({ look, onChange }: { look: MateLookDraft;
  onChange: (patch: Partial<MateLookDraft>) => void }): ReactNode {
  const [tab, setTab] = useState<Tab>('character');
  const bot: BotLook = { kind: 'mate', character: look.avatar, hue: look.hue, variant: look.variant, face: look.face };
  return <div className="look-picker">
    <div className="segmented look-picker-tabs" role="group" aria-label="头像">
      {TABS.map(([id, label]) => <button key={id} type="button" className="segmented-item" aria-pressed={tab === id}
        onClick={() => setTab(id)}>{label}</button>)}
    </div>
    <div key={tab} className="look-grid">
      {tab === 'character' ? <CharacterPicker value={look.avatar} look={bot}
        onChange={(avatar) => onChange({ avatar })} />
        : tab === 'variant' ? <LookChoices kind="variant" look={bot} onChange={(variant) => onChange({ variant })} />
          : <LookChoices kind="face" look={bot} onChange={(face) => onChange({ face })} />}
    </div>
  </div>;
}

type ChoicesProps<K extends 'variant' | 'face'> = { kind: K; look: BotLook;
  onChange: (value: K extends 'variant' ? MateVariant : MateFace) => void };

/** 画风或脸型的一排格子：每一格是这个头像换上它的样子，下面写名字。 */
export function LookChoices<K extends 'variant' | 'face'>({ kind, look, onChange }: ChoicesProps<K>): ReactNode {
  const engine = useBotEngine();
  const ids: readonly string[] = kind === 'variant' ? MATE_VARIANTS : MATE_FACES;
  const names: Readonly<Record<string, string>> = kind === 'variant' ? VARIANT_NAMES : FACE_NAMES;
  const current = kind === 'variant' ? look.variant : look.kind === 'mate' ? look.face : null;
  return <div className="look-choices" role="group" aria-label={kind === 'variant' ? '画风' : '脸型'}
    aria-busy={engine === null}>
    {engine === null ? null : ids.map((id) => (
      <button key={id} type="button" className="look-choice" aria-pressed={id === current}
        onClick={() => onChange(id as K extends 'variant' ? MateVariant : MateFace)}>
        <span aria-hidden="true" className="character-choice-art"
          dangerouslySetInnerHTML={{ __html: stillSvg(engine, { ...look, [kind]: id } as BotLook, 'idle', 30) }} />
        <span className="look-choice-name">{names[id]}</span>
      </button>
    ))}
  </div>;
}
