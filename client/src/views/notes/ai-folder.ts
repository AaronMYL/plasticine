import type { NoteMetaView } from '../../api/shared.ts';

export const AI_NOTE_FOLDER = 'Plasticine 写的';

export function isAiFolder(folder: string): boolean {
  return folder === AI_NOTE_FOLDER;
}

export function isAiNote(note: Pick<NoteMetaView, 'folder' | 'author'>): boolean {
  return isAiFolder(note.folder) || note.author === 'ai';
}
