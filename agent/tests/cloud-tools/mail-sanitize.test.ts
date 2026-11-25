import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sanitizeMailHtml } from '../../src/cloud-tools/mail-sanitize.ts';

test('strips scripts, iframes, objects, forms, and meta refresh with contents while keeping body', () => {
  const html = '<html><head><meta http-equiv="refresh" content="0;url=https://evil.test">'
    + '<title>标题</title><script>alert(1)</script><link rel="stylesheet" href="https://x.test/a.css"></head>'
    + '<body><p>正文</p><iframe src="https://x.test"><p>框里</p></iframe><object data="x.swf">插件</object>'
    + '<embed src="x.swf"><form action="https://evil.test"><input name="pw"><button>提交</button>表单字</form>'
    + '<svg><script>alert(2)</script></svg><noscript>别显示</noscript></body></html>';
  const clean = sanitizeMailHtml(html);
  assert.doesNotMatch(clean, /script|iframe|object|embed|<form|<input|<button|meta|refresh|<link|<svg|noscript/i);
  assert.doesNotMatch(clean, /框里|插件|别显示|alert/);
  assert.match(clean, /<p>正文<\/p>/);
  assert.match(clean, /表单字/);
});

test('strips all on* event attributes while preserving allowlisted attributes', () => {
  const clean = sanitizeMailHtml('<div onclick="x()" class="c" style="color:red" onmouseover=y()>'
    + '<img src="https://img.test/a.png" onerror="z()" alt="图" width="10"></div>');
  assert.doesNotMatch(clean, /on(click|mouseover|error)|x\(\)|y\(\)|z\(\)/);
  assert.match(clean, /<div class="c" style="color:red">/);
  assert.match(clean, /<img src="https:\/\/img\.test\/a\.png" alt="图" width="10">/);
});

test('strips javascript: links (with entities/spaces/case) and adds target blank + noopener to safe', () => {
  const clean = sanitizeMailHtml('<a href="javascript:alert(1)">一</a><a href="&#106;avascript:alert(2)">二</a>'
    + '<a href="java\tscript:alert(3)">三</a><a href=" JaVaScRiPt:alert(4)">四</a><a href="data:text/html,x">五</a>'
    + '<a href="https://ok.test/?a=1&amp;b=2">六</a><a href="mailto:a@example.test">七</a><a href="//cdn.test/x">八</a>');
  assert.doesNotMatch(clean, /javascript|alert|data:/i);
  assert.match(clean, /<a>一<\/a>/);
  assert.match(clean, /<a href="https:\/\/ok\.test\/\?a=1&amp;b=2" target="_blank" rel="noopener noreferrer">六<\/a>/);
  assert.match(clean, /<a href="mailto:a@example\.test" target="_blank" rel="noopener noreferrer">七<\/a>/);
  assert.match(clean, /<a href="https:\/\/cdn\.test\/x" target="_blank" rel="noopener noreferrer">八<\/a>/);
});

test('keeps inline styles and <style> while stripping @import, expression, and -moz-binding', () => {
  const clean = sanitizeMailHtml('<style>@import url(https://x.test/a.css); .a{color:red} '
    + '.b{width:expression(alert(1))} .c{-moz-binding:url(x.xml#y)}</style>'
    + '<p style="color:blue;behavior:url(x.htc)">字</p>');
  assert.match(clean, /<style>[^<]*\.a\{color:red\}/);
  assert.doesNotMatch(clean, /@import|expression|moz-binding|behavior|x\.htc|a\.css/);
  assert.match(clean, /<p style="color:blue">字<\/p>/);
});

test('image URLs allow only cid:, http(s), and small data:image by default, stripping others', () => {
  const clean = sanitizeMailHtml('<img src="cid:logo@x"><img src="http://img.test/a.gif">'
    + '<img src="data:image/png;base64,iVBORw0KGgo="><img src="file:///etc/passwd"><img src="data:text/html,x">'
    + '<img src="https://t.test/p.gif" srcset="https://t.test/p2.gif 2x">');
  assert.match(clean, /<img src="cid:logo@x">/);
  assert.match(clean, /<img src="http:\/\/img\.test\/a\.gif">/);
  assert.match(clean, /<img src="data:image\/png;base64,iVBORw0KGgo=">/);
  assert.doesNotMatch(clean, /passwd|text\/html|srcset|p2\.gif/);
});

test('image rewrite callback processes img, background attr, and CSS url(); null return strips it', () => {
  const seen: string[] = [];
  const clean = sanitizeMailHtml('<table background="https://img.test/bg.png"><tr><td>'
    + '<img src="cid:a@x"><img src="https://img.test/b.png"></td></tr></table>'
    + '<div style="background-image:url(\'https://img.test/c.png\')">x</div>'
    + '<style>.h{background:url("cid:a@x") no-repeat}</style>', {
    image: (url) => {
      seen.push(url);
      return url.startsWith('cid:') ? 'data:image/png;base64,AAAA' : null;
    },
  });
  assert.deepEqual(seen.sort(), ['cid:a@x', 'cid:a@x', 'https://img.test/b.png', 'https://img.test/bg.png',
    'https://img.test/c.png']);
  assert.doesNotMatch(clean, /img\.test/);
  assert.match(clean, /<img src="data:image\/png;base64,AAAA">/);
  assert.match(clean, /\.h\{background:url\("data:image\/png;base64,AAAA"\) no-repeat\}/);
});

test('preserves entities, escapes stray <, strips comments/doctype, keeps text of unknown tags', () => {
  const clean = sanitizeMailHtml('<!DOCTYPE html><!--[if mso]><p>mso</p><![endif]--><p>a &lt; b &amp; c < d</p>'
    + '<o:p>办公</o:p><custom-tag data-x="1">自定义</custom-tag>');
  assert.equal(clean, '<p>a &lt; b &amp; c &lt; d</p>办公自定义');
});

test('unclosed tags, attributes, and comments cannot let trailing markup escape sanitization', () => {
  assert.doesNotMatch(sanitizeMailHtml('<p>ok</p><img src="x" onerror="alert(1)'), /onerror|alert/);
  assert.doesNotMatch(sanitizeMailHtml('<p>ok<script>alert(1)'), /alert/);
  assert.doesNotMatch(sanitizeMailHtml('<p>ok<!-- <script>alert(1)</script>'), /alert/);
  assert.doesNotMatch(sanitizeMailHtml('<style>p{}</style ><script>alert(1)</script>'), /alert/);
});
