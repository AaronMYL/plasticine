import type { ResolvedConversationQuote, SpaceQuoteReference } from '../../shared/conversation-quotes.ts';
import { normalizeSpaceSelection, spaceParagraphs } from '../../shared/space-selection.ts';
import type { StateService } from '../state/index.ts';
import { ApiError } from './api-error.ts';

export function resolveSpaceQuote(state: StateService, reference: SpaceQuoteReference): ResolvedConversationQuote {
  const space = state.spaces.get(reference.spaceId);
  if (space === undefined || space.deletedAt !== null) {
    throw new ApiError(409, 'space_quote_unavailable', '引用的空间已不在资料库，请移除引用后再发。');
  }
  const revision = state.spaces.revision(reference.spaceId, reference.version);
  if (revision?.html === null || revision === undefined) {
    throw new ApiError(409, 'space_quote_version_missing', '找不到引用时的空间版本，请打开空间重新引用。');
  }
  const { anchor } = reference;
  const paragraphs = spaceParagraphs(revision.html);
  const first = paragraphs[anchor.paragraph - 1];
  const selected = normalizeSpaceSelection(anchor.text);
  const rest = paragraphs.slice(anchor.paragraph - 1).map((paragraph) => paragraph.text).join(' ');
  const at = rest.indexOf(selected);
  if (selected === '' || first === undefined || first.sectionId !== anchor.sectionId || at < 0 || at >= first.text.length) {
    throw new ApiError(409, 'space_quote_changed', '引用与该版本的原文位置对不上，请重新选中文字。');
  }
  const kind = revision.genre === 'letter' ? '来信' : '报告';
  return { label: `${kind} · ${revision.title} · 第 ${anchor.paragraph} 段`, text: anchor.text, spaceReference: reference };
}
