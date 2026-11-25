import type { Block, Inline } from './markdown-blocks.ts';
import { contentTypes, EMU_PER_PX, type ImageData, packageRels, type Relation, relsXml, XML_HEAD, xmlEscape } from
  './package-xml.ts';
import { writeZip, type ZipFile } from './zip-write.ts';

const W_MAIN = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const NAMESPACES = [
  `xmlns:w="${W_MAIN}"`,
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"',
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"',
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"',
  'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"',
].join(' ');
const PICTURE_URI = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const MAX_WIDTH_EMU = 6 * 914400;
const HEADING_SIZES = [36, 30, 26] as const;
const LINE_COLOR = 'BFB8AE';
const SHADE = 'F1EEE8';

const MAIN_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml';

function runProps(part: Inline): string {
  const props = [
    part.bold === true ? '<w:b/>' : '',
    part.italic === true ? '<w:i/>' : '',
    part.code === true ? `<w:rFonts w:ascii="Menlo" w:hAnsi="Menlo"/><w:shd w:val="clear" w:fill="${SHADE}"/>` : '',
    part.link === undefined ? '' : '<w:color w:val="3A72A3"/><w:u w:val="single"/>',
  ].join('');
  return props === '' ? '' : `<w:rPr>${props}</w:rPr>`;
}

function runs(inline: readonly Inline[]): string {
  return inline.map((part) =>
    `<w:r>${runProps(part)}<w:t xml:space="preserve">${xmlEscape(part.text)}</w:t></w:r>`).join('');
}

function paragraph(inline: readonly Inline[], style?: string, extra = ''): string {
  const props = `${style === undefined ? '' : `<w:pStyle w:val="${style}"/>`}${extra}`;
  return `<w:p>${props === '' ? '' : `<w:pPr>${props}</w:pPr>`}${runs(inline)}</w:p>`;
}

function drawing(rel: string, id: number, image: ImageData, alt: string): string {
  const width = Math.min(MAX_WIDTH_EMU, image.width * EMU_PER_PX);
  const height = Math.round(width * image.height / Math.max(1, image.width));
  const extent = `cx="${width}" cy="${height}"`;
  const picture = `<pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name="图 ${id}"/><pic:cNvPicPr/></pic:nvPicPr>`
    + `<pic:blipFill><a:blip r:embed="${rel}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>`
    + `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext ${extent}/></a:xfrm>`
    + '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>';
  return `<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent ${extent}/>`
    + `<wp:docPr id="${id}" name="图 ${id}" descr="${xmlEscape(alt)}"/>`
    + `<a:graphic><a:graphicData uri="${PICTURE_URI}">${picture}</a:graphicData></a:graphic>`
    + '</wp:inline></w:drawing></w:r></w:p>';
}

function tableCell(inline: readonly Inline[], bold: boolean): string {
  const content = bold ? inline.map((part) => ({ ...part, bold: true })) : inline;
  return `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr>${paragraph(content)}</w:tc>`;
}

function table(head: readonly Inline[][], rows: readonly Inline[][][]): string {
  const borders = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
    .map((side) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="${LINE_COLOR}"/>`).join('');
  const header = `<w:tr>${head.map((inline) => tableCell(inline, true)).join('')}</w:tr>`;
  const body = rows.map((row) => `<w:tr>${head.map((_, index) => tableCell(row[index] ?? [], false)).join('')}</w:tr>`);
  return `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>${borders}</w:tblBorders></w:tblPr>`
    + `${header}${body.join('')}</w:tbl><w:p/>`;
}

function headingStyle(level: number): string {
  return `<w:style w:type="paragraph" w:styleId="Heading${level}"><w:name w:val="heading ${level}"/>`
    + '<w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/>'
    + `<w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="${level - 1}"/></w:pPr>`
    + `<w:rPr><w:b/><w:sz w:val="${HEADING_SIZES[level - 1] ?? 26}"/></w:rPr></w:style>`;
}

const STYLES = `${XML_HEAD}<w:styles xmlns:w="${W_MAIN}">`
  + '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="PingFang SC"/>'
  + '<w:sz w:val="22"/><w:lang w:val="zh-CN" w:eastAsia="zh-CN"/></w:rPr></w:rPrDefault>'
  + '<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="300" w:lineRule="auto"/></w:pPr></w:pPrDefault>'
  + '</w:docDefaults>'
  + '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>'
  + [1, 2, 3].map(headingStyle).join('')
  + '<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/>'
  + '<w:pPr><w:ind w:left="480"/></w:pPr><w:rPr><w:color w:val="5A534B"/></w:rPr></w:style>'
  + '<w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/><w:basedOn w:val="Normal"/>'
  + `<w:pPr><w:shd w:val="clear" w:fill="${SHADE}"/><w:spacing w:after="0"/></w:pPr>`
  + '<w:rPr><w:rFonts w:ascii="Menlo" w:hAnsi="Menlo"/><w:sz w:val="20"/></w:rPr></w:style>'
  + '<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/>'
  + '<w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="60"/></w:pPr></w:style></w:styles>';

function numberingXml(lists: readonly boolean[]): string {
  const abstracts = lists.map((ordered, id) => `<w:abstractNum w:abstractNumId="${id}">`
    + '<w:multiLevelType w:val="singleLevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/>'
    + `<w:numFmt w:val="${ordered ? 'decimal' : 'bullet'}"/><w:lvlText w:val="${ordered ? '%1.' : '•'}"/>`
    + '<w:lvlJc w:val="left"/><w:pPr><w:ind w:left="480" w:hanging="300"/></w:pPr></w:lvl></w:abstractNum>');
  const nums = lists.map((_, id) => `<w:num w:numId="${id + 1}"><w:abstractNumId w:val="${id}"/></w:num>`);
  return `${XML_HEAD}<w:numbering xmlns:w="${W_MAIN}">${abstracts.join('')}${nums.join('')}</w:numbering>`;
}

const RULE = `<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="4" w:space="1" w:color="${LINE_COLOR}"/>`
  + '</w:pBdr></w:pPr></w:p>';
const SECTION = '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" '
  + 'w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>';

export function makeDocx(blocks: readonly Block[], image: (src: string) => ImageData | null): Buffer {
  const lists: boolean[] = [];
  const media: ZipFile[] = [];
  const rels: Relation[] = [
    { id: 'rId1', type: 'styles', target: 'styles.xml' },
    { id: 'rId2', type: 'numbering', target: 'numbering.xml' },
  ];
  const blockXml = (block: Block): string => {
    switch (block.kind) {
      case 'heading':
        return paragraph(block.inline, `Heading${block.level}`);
      case 'paragraph':
        return paragraph(block.inline);
      case 'quote':
        return paragraph(block.inline, 'Quote');
      case 'code':
        return block.text.split('\n').map((line) => paragraph([{ text: line }], 'Code')).join('');
      case 'rule':
        return RULE;
      case 'table':
        return table(block.head, block.rows);
      case 'list': {
        lists.push(block.ordered);
        const numbering = `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="${lists.length}"/></w:numPr>`;
        return block.items.map((item) => paragraph(item, 'ListParagraph', numbering)).join('');
      }
      case 'image': {
        const found = image(block.src);
        if (found === null) {
          return paragraph([{ text: `［图：${block.alt === '' ? block.src : block.alt}］` }]);
        }
        const index = media.length + 1;
        const rel = `rId${rels.length + 1}`;
        media.push({ name: `word/media/image${index}.${found.type}`, data: found.data });
        rels.push({ id: rel, type: 'image', target: `media/image${index}.${found.type}` });
        return drawing(rel, index, found, block.alt);
      }
    }
  };
  const body = blocks.map(blockXml).join('');
  const document = `${XML_HEAD}<w:document ${NAMESPACES}><w:body>${body}${SECTION}</w:body></w:document>`;
  return writeZip([
    { name: '[Content_Types].xml', data: contentTypes([
      ['/word/document.xml', `${MAIN_TYPE}.document.main+xml`],
      ['/word/styles.xml', `${MAIN_TYPE}.styles+xml`],
      ['/word/numbering.xml', `${MAIN_TYPE}.numbering+xml`],
    ]) },
    { name: '_rels/.rels', data: packageRels('word/document.xml') },
    { name: 'word/document.xml', data: document },
    { name: 'word/styles.xml', data: STYLES },
    { name: 'word/numbering.xml', data: numberingXml(lists) },
    { name: 'word/_rels/document.xml.rels', data: relsXml(rels) },
    ...media,
  ]);
}
