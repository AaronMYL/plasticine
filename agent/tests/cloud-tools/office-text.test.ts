// Word、Excel、PowerPoint 读成文字（第13批）：自己读 zip 里的 XML，不加新包。测试里现拼几份最小的文件。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { officeText } from '../../src/cloud-tools/office-text.ts';
import { zip } from './zip-fixture.ts';

test('Word：按段落，制表和换行留着，实体解开', () => {
  const doc = zip({ 'word/document.xml': '<w:document><w:body>'
    + '<w:p><w:r><w:t>第一段</w:t></w:r><w:r><w:t xml:space="preserve"> 接着 &amp; 写</w:t></w:r></w:p>'
    + '<w:p><w:r><w:t>甲</w:t><w:tab/><w:t>乙</w:t></w:r></w:p><w:p></w:p></w:body></w:document>' });
  assert.equal(officeText('docx', doc), '第一段 接着 & 写\n甲\t乙');
});

test('Excel：每张表一节，行里格子用制表符，共享字符串和数字都读出来', () => {
  const book = zip({
    'xl/workbook.xml': '<workbook><sheets><sheet name="预算" sheetId="1"/><sheet name="明细" sheetId="2"/></sheets>'
      + '</workbook>',
    'xl/sharedStrings.xml': '<sst><si><t>房租</t></si><si><r><t>水</t></r><r><t>电</t></r></si></sst>',
    'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1"><v>3200</v></c>'
      + '</row><row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2"><v>180.5</v></c></row></sheetData></worksheet>',
    'xl/worksheets/sheet2.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>备注</t></is></c>'
      + '</row></sheetData></worksheet>',
  });
  assert.equal(officeText('xlsx', book), '## 预算\n房租\t3200\n水电\t180.5\n\n## 明细\n备注');
});

test('PowerPoint：按页，每页的段落一行一段', () => {
  const deck = zip({
    'ppt/slides/slide2.xml': '<p:sld><a:p><a:r><a:t>第二页标题</a:t></a:r></a:p></p:sld>',
    'ppt/slides/slide1.xml': '<p:sld><a:p><a:r><a:t>开场</a:t></a:r></a:p><a:p><a:r><a:t>要点</a:t></a:r></a:p></p:sld>',
  });
  assert.equal(officeText('pptx', deck), '## 第 1 页\n开场\n要点\n\n## 第 2 页\n第二页标题');
});

test('不是 zip、缺文件：读不了就是 null', () => {
  assert.equal(officeText('docx', Buffer.from('not a zip at all, just text')), null);
  assert.equal(officeText('pptx', zip({ 'word/document.xml': '<w:p/>' })), null);
});
