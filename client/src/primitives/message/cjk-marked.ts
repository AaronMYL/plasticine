import { marked } from 'marked';
import markedCjkFriendly from 'marked-cjk-friendly';

marked.use(markedCjkFriendly());

export const cjkMarked = marked;
