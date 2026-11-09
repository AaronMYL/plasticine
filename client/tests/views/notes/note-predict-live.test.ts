// 边打边吃（2026-11-09 他定，照 Copilot / Cursor）：接着打的字和灰字开头一样就留着灰字、只去掉打出的部分；
// 对不上、光标挪走、别处改了才作废。中文输入法一次提交几个字和一个个打一样算。

import { Schema, type Node as DocumentNode } from '@tiptap/pm/model';
import { describe, expect, it } from 'vitest';
import { followTyping, ghostPosition, remaining, startPrediction, withDelta, withFinal }
  from '../../../src/views/notes/note-predict-live.ts';

const schema = new Schema({ nodes: {
  doc: { content: 'paragraph+' },
  paragraph: { content: 'text*' },
  text: {},
} });

function doc(...paragraphs: string[]): DocumentNode {
  return schema.node('doc', null, paragraphs.map((text) => schema.node('paragraph', null,
    text === '' ? [] : [schema.text(text)])));
}

const BEFORE = '正在记录这段经历';
const END = 1 + BEFORE.length;
const SUGGESTION = '，然后把事实记清楚。';

function shown(): ReturnType<typeof startPrediction> {
  return withDelta(startPrediction(END, doc(BEFORE, '后文')), SUGGESTION);
}

describe('续写跟着打字走', () => {
  it('正文和光标都没变：原样留着', () => {
    const live = shown();
    expect(followTyping(live, live.doc, { empty: true, from: END })).toBe(live);
  });

  it('接着打的字是灰字的开头：吃掉打出的部分，灰字往后挪', () => {
    const next = followTyping(shown(), doc(`${BEFORE}，然`, '后文'), { empty: true, from: END + 2 });
    expect(next?.typed).toBe(2);
    expect(next === null ? null : remaining(next)).toBe('后把事实记清楚。');
    expect(next === null ? null : ghostPosition(next)).toBe(END + 2);
  });

  it('输入法一次提交几个字和一个个打一样；接着再打也接着吃', () => {
    const first = followTyping(shown(), doc(`${BEFORE}，然后把`, '后文'), { empty: true, from: END + 4 });
    expect(first?.typed).toBe(4);
    const second = first === null ? null
      : followTyping(first, doc(`${BEFORE}，然后把事实`, '后文'), { empty: true, from: END + 6 });
    expect(second === null ? null : remaining(second)).toBe('记清楚。');
  });

  it('打的字和灰字对不上、删字、光标挪走：作废', () => {
    expect(followTyping(shown(), doc(`${BEFORE}，但`, '后文'), { empty: true, from: END + 2 })).toBeNull();
    expect(followTyping(shown(), doc('正在记录这段经', '后文'), { empty: true, from: END - 1 })).toBeNull();
    const live = shown();
    expect(followTyping(live, live.doc, { empty: true, from: 1 })).toBeNull();
    expect(followTyping(live, live.doc, { empty: false, from: END })).toBeNull();
  });

  it('同时别处也改了（另一段多了字）：不算照着打，作废', () => {
    expect(followTyping(shown(), doc(`${BEFORE}，`, '后文改'), { empty: true, from: END + 1 })).toBeNull();
  });

  it('换了一段（回车）不是照着打', () => {
    expect(followTyping(shown(), doc(BEFORE, '', '后文'), { empty: true, from: END + 2 })).toBeNull();
  });

  it('打得比已经到的灰字还多：先作废，等下一次停笔', () => {
    const partial = withDelta(startPrediction(END, doc(BEFORE, '后文')), '，然');
    expect(followTyping(partial, doc(`${BEFORE}，然后`, '后文'), { empty: true, from: END + 3 })).toBeNull();
  });

  it('最终文字到了以它为准；它的开头和已经打出的对不上就作废', () => {
    const typed = followTyping(shown(), doc(`${BEFORE}，然`, '后文'), { empty: true, from: END + 2 });
    expect(typed).not.toBeNull();
    if (typed === null) { return; }
    const final = withFinal(typed, '，然后把事实记清楚');
    expect(final?.done).toBe(true);
    expect(final === null ? null : remaining(final)).toBe('后把事实记清楚');
    expect(withFinal(typed, '，但')).toBeNull();
  });
});
