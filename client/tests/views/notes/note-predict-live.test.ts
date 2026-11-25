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

describe('Continuation follows typing', () => {
  it('keeps ghost text intact when body and cursor are unchanged', () => {
    const live = shown();
    expect(followTyping(live, live.doc, { empty: true, from: END })).toBe(live);
  });

  it('consumes matching typed prefix and shifts remaining ghost text forward', () => {
    const next = followTyping(shown(), doc(`${BEFORE}，然`, '后文'), { empty: true, from: END + 2 });
    expect(next?.typed).toBe(2);
    expect(next === null ? null : remaining(next)).toBe('后把事实记清楚。');
    expect(next === null ? null : ghostPosition(next)).toBe(END + 2);
  });

  it('IME multi-char commit consumes matching prefix just like single-char typing', () => {
    const first = followTyping(shown(), doc(`${BEFORE}，然后把`, '后文'), { empty: true, from: END + 4 });
    expect(first?.typed).toBe(4);
    const second = first === null ? null
      : followTyping(first, doc(`${BEFORE}，然后把事实`, '后文'), { empty: true, from: END + 6 });
    expect(second === null ? null : remaining(second)).toBe('记清楚。');
  });

  it('invalidates ghost text on mismatch, deletion, or cursor move', () => {
    expect(followTyping(shown(), doc(`${BEFORE}，但`, '后文'), { empty: true, from: END + 2 })).toBeNull();
    expect(followTyping(shown(), doc('正在记录这段经', '后文'), { empty: true, from: END - 1 })).toBeNull();
    const live = shown();
    expect(followTyping(live, live.doc, { empty: true, from: 1 })).toBeNull();
    expect(followTyping(live, live.doc, { empty: false, from: END })).toBeNull();
  });

  it('invalidates ghost text when another paragraph is also modified', () => {
    expect(followTyping(shown(), doc(`${BEFORE}，`, '后文改'), { empty: true, from: END + 1 })).toBeNull();
  });

  it('pressing Enter to start a new paragraph does not count as typing along', () => {
    expect(followTyping(shown(), doc(BEFORE, '', '后文'), { empty: true, from: END + 2 })).toBeNull();
  });

  it('invalidates ghost text when typing overtakes arrived text and waits for next pause', () => {
    const partial = withDelta(startPrediction(END, doc(BEFORE, '后文')), '，然');
    expect(followTyping(partial, doc(`${BEFORE}，然后`, '后文'), { empty: true, from: END + 3 })).toBeNull();
  });

  it('uses final text when it arrives and invalidates if its prefix mismatches typed text', () => {
    const typed = followTyping(shown(), doc(`${BEFORE}，然`, '后文'), { empty: true, from: END + 2 });
    expect(typed).not.toBeNull();
    if (typed === null) { return; }
    const final = withFinal(typed, '，然后把事实记清楚');
    expect(final?.done).toBe(true);
    expect(final === null ? null : remaining(final)).toBe('后把事实记清楚');
    expect(withFinal(typed, '，但')).toBeNull();
  });
});
