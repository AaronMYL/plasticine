import type { Node as DocumentNode } from '@tiptap/pm/model';

export interface LivePrediction {
  readonly anchor: number;
  readonly text: string;
  readonly typed: number;
  readonly done: boolean;
  readonly doc: DocumentNode;
}

export interface CursorLike {
  readonly empty: boolean;
  readonly from: number;
}

export function startPrediction(anchor: number, doc: DocumentNode): LivePrediction {
  return { anchor, text: '', typed: 0, done: false, doc };
}

export function remaining(live: LivePrediction): string {
  return live.text.slice(live.typed);
}

export function ghostPosition(live: LivePrediction): number {
  return live.anchor + live.typed;
}

export function withDelta(live: LivePrediction, delta: string): LivePrediction {
  return { ...live, text: live.text + delta };
}

export function withFinal(live: LivePrediction, text: string): LivePrediction | null {
  return text.startsWith(live.text.slice(0, live.typed)) ? { ...live, text, done: true } : null;
}

export function followTyping(live: LivePrediction, doc: DocumentNode, cursor: CursorLike): LivePrediction | null {
  const position = ghostPosition(live);
  if (doc === live.doc) {
    return cursor.empty && cursor.from === position ? live : null;
  }
  const added = doc.content.size - live.doc.content.size;
  if (added <= 0 || added > remaining(live).length || !cursor.empty || cursor.from !== position + added) {
    return null;
  }
  const inserted = doc.textBetween(position, position + added);
  if (inserted.length !== added || inserted !== remaining(live).slice(0, added)) {
    return null;
  }
  const untouched = doc.cut(0, position).eq(live.doc.cut(0, position))
    && doc.cut(position + added).eq(live.doc.cut(position));
  return untouched ? { ...live, typed: live.typed + added, doc } : null;
}
