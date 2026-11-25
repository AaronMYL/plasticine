import assert from 'node:assert/strict';
import { test } from 'node:test';
import { noteAssetRefs } from '../../src/state/note-asset-refs.ts';

test('Image refs match only real local images, ignoring text/prefix/external/examples', () => {
  const markdown = [
    '普通文字 public.png 以及 /v2/notes/assets/public.png',
    '![较长资源](/v2/notes/assets/prefix-public.png)',
    '![站外](https://elsewhere.test/v2/notes/assets/public.png)',
    '`![代码](/v2/notes/assets/public.png)`',
    '```md\n![代码块](/v2/notes/assets/public.png)\n```',
    '![本站](/v2/notes/assets/inline%2Epng?version=1#图)',
    '<img src="/v2/notes/assets/html.png">',
    '![引用图][picture]\n\n[picture]: /v1/notes/assets/legacy.png "旧图"',
    '![绝对本站](https://plasticine.test/v2/notes/assets/absolute.png)',
  ].join('\n\n');
  assert.deepEqual([...noteAssetRefs(markdown, 'https://plasticine.test')].sort(),
    ['absolute.png', 'html.png', 'inline.png', 'legacy.png', 'prefix-public.png']);
  assert.deepEqual([...noteAssetRefs(markdown)].sort(), ['html.png', 'inline.png', 'legacy.png', 'prefix-public.png']);
});
