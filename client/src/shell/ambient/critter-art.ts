// 地上的四种小动物（11-13 Aaron：「增加兔子、狐狸、小狗、猫咪这种可爱的」）：正脸 + 小身子 + 身后的尾巴，朝右画，
// 朝左时左右镜像。每个姿势几帧轮着换（走路迈爪、兔子蹦）。空格是透明的。

import type { Tone } from './body.ts';

export const CRITTER_KINDS = ['cat', 'dog', 'rabbit', 'fox'] as const;
export type CritterKind = (typeof CRITTER_KINDS)[number];
export type Pose = 'sit' | 'walk' | 'sleep';

type Frame = readonly string[];

export interface CritterArt {
  frames: Readonly<Record<Pose, readonly Frame[]>>;
  /** 哪些字另上色：眼睛、鼻子。 */
  colors: Readonly<Record<string, Tone>>;
}

export const CRITTER_ART: Readonly<Record<CritterKind, CritterArt>> = {
  cat: {
    frames: {
      sit: [[
        ' /\\_/\\ ',
        '( o.o )',
        ' > ^ < ',
        '(")_(")~',
      ]],
      walk: [[
        '  /\\_/\\ ',
        ' (  o.o)',
        '  > ^ < ',
        '~(")_(")',
      ], [
        '  /\\_/\\ ',
        ' (  o.o)',
        '  > ^ < ',
        ' ~(") (")',
      ]],
      sleep: [[
        ' /\\_/\\ ',
        '( -.- )',
        ' > ^ < ',
        '(")_(")~',
      ]],
    },
    colors: { o: 'ink', '^': 'rose' },
  },
  dog: {
    frames: {
      sit: [[
        '  .---. ',
        '_/ o o \\_',
        '(_| ω |_)',
        '  (")(") ',
      ]],
      walk: [[
        '   .---. ',
        ' _/  o o\\_',
        '~(_|  ω|_)',
        '   (")(") ',
      ], [
        '   .---. ',
        ' _/  o o\\_',
        '/(_|  ω|_)',
        '  (")  (")',
      ]],
      sleep: [[
        '  .---. ',
        '_/ - - \\_',
        '(_| ω |_)',
        '  (")(")~',
      ]],
    },
    colors: { o: 'ink', 'ω': 'rose' },
  },
  rabbit: {
    frames: {
      sit: [[
        '(\\_/)',
        '(o.o)',
        '(> <)',
        '(")(")',
      ]],
      walk: [[
        ' (\\(\\',
        ' ( o.o)',
        'o(> <)',
        ' (")(")',
      ], [
        ' //)/)',
        '( o.o)',
        'o(> <)',
        '  " " ',
      ]],
      sleep: [[
        '(\\_/)',
        '(-.-)',
        '(> <)',
        '(")(")',
      ]],
    },
    colors: { o: 'ink' },
  },
  fox: {
    frames: {
      sit: [[
        ' /\\   /\\',
        ' \\ o.o /',
        '  \\ v /',
        '  /   \\ ((',
        ' (")_(")))',
      ]],
      walk: [[
        '     /\\   /\\',
        '     \\  o.o/',
        '      \\  v/',
        '(((___/   \\',
        '     (")_(")',
      ], [
        '     /\\   /\\',
        '     \\  o.o/',
        '      \\  v/',
        '(((___/   \\',
        '    (")  (")',
      ]],
      sleep: [[
        ' /\\   /\\',
        ' \\ -.- /',
        '((\\ v /))',
        ' ((___)) ',
      ]],
    },
    colors: { o: 'ink', v: 'ink' },
  },
};

const MIRROR: Readonly<Record<string, string>> = {
  '(': ')', ')': '(', '/': '\\', '\\': '/', '<': '>', '>': '<', '[': ']', ']': '[', '{': '}', '}': '{',
};

/** 朝左：每一行倒过来，括号、斜线换个方向；行宽补齐，脚底中点不跳。 */
export function mirrorFrame(frame: Frame): Frame {
  const width = Math.max(...frame.map((row) => row.length));
  return frame.map((row) => [...row.padEnd(width)].reverse().map((char) => MIRROR[char] ?? char).join(''));
}
