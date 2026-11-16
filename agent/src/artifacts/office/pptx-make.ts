// 几页写成 .pptx（11-16）：16:9，一个母版一个版式（标题加正文），每页一个标题、几条要点，可带一张图放右半边。
// 主题色和字体照 Plasticine 的暖色调；讲稿备注第一版不做。

import { contentTypes, EMU_PER_PX, type ImageData, imageInfo, packageRels, type Relation, relsXml, XML_HEAD, xmlEscape }
  from './package-xml.ts';
import { writeZip, type ZipFile } from './zip-write.ts';

export interface SlideInput {
  title: string;
  bullets?: string[];
  image?: Buffer;
}

const NAMESPACES = [
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"',
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"',
  'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"',
].join(' ');
const MAIN_TYPE = 'application/vnd.openxmlformats-officedocument';
const SLIDE_W = 12192000;
const SLIDE_H = 6858000;
const MARGIN = 457200;
const TITLE_H = 1143000;
const BODY_TOP = 1828800;
const BODY_H = SLIDE_H - BODY_TOP - MARGIN;
const FULL_W = SLIDE_W - 2 * MARGIN;

const COLORS: readonly (readonly [string, string])[] = [
  ['dk1', '1F1D1A'], ['lt1', 'FFFFFF'], ['dk2', '5A534B'], ['lt2', 'FAF8F4'], ['accent1', 'A15B3D'],
  ['accent2', '3A72A3'], ['accent3', '2F7A6E'], ['accent4', '8A6622'], ['accent5', '7D5A92'], ['accent6', '587559'],
  ['hlink', '3A72A3'], ['folHlink', '7D5A92'],
];

function triple(inner: string): string {
  return inner + inner + inner;
}

const SOLID = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>';
const FONTS = '<a:latin typeface="Calibri"/><a:ea typeface="PingFang SC"/><a:cs typeface=""/>';
const THEME = `${XML_HEAD}<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Plasticine">`
  + '<a:themeElements><a:clrScheme name="Plasticine">'
  + COLORS.map(([name, value]) => `<a:${name}><a:srgbClr val="${value}"/></a:${name}>`).join('')
  + `</a:clrScheme><a:fontScheme name="Plasticine"><a:majorFont>${FONTS}</a:majorFont>`
  + `<a:minorFont>${FONTS}</a:minorFont></a:fontScheme><a:fmtScheme name="Plasticine">`
  + `<a:fillStyleLst>${triple(SOLID)}</a:fillStyleLst>`
  + `<a:lnStyleLst>${[6350, 12700, 19050].map((w) => `<a:ln w="${w}">${SOLID}</a:ln>`).join('')}</a:lnStyleLst>`
  + `<a:effectStyleLst>${triple('<a:effectStyle><a:effectLst/></a:effectStyle>')}</a:effectStyleLst>`
  + `<a:bgFillStyleLst>${triple(SOLID)}</a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;

function xfrm(x: number, y: number, w: number, h: number): string {
  return `<a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm>`;
}

const GROUP = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>'
  + '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/>'
  + '</a:xfrm></p:grpSpPr>';
const EMPTY_TEXT = '<a:p><a:endParaRPr lang="zh-CN"/></a:p>';

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

function placeholder(id: number, type: 'title' | 'body', box: Box, text: string): string {
  const name = type === 'title' ? '标题' : '正文';
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>`
    + `<p:nvPr><p:ph type="${type}"${type === 'body' ? ' idx="1"' : ''}/></p:nvPr></p:nvSpPr>`
    + `<p:spPr>${xfrm(box.x, box.y, box.w, box.h)}</p:spPr><p:txBody><a:bodyPr/><a:lstStyle/>${text}</p:txBody></p:sp>`;
}

const TITLE_BOX: Box = { x: MARGIN, y: MARGIN, w: FULL_W, h: TITLE_H };
const BODY_BOX: Box = { x: MARGIN, y: BODY_TOP, w: FULL_W, h: BODY_H };
const SHAPES = placeholder(2, 'title', TITLE_BOX, EMPTY_TEXT) + placeholder(3, 'body', BODY_BOX, EMPTY_TEXT);

const TEXT_STYLES = '<p:txStyles><p:titleStyle><a:lvl1pPr><a:defRPr sz="3600" b="1">'
  + '<a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mj-lt"/><a:ea typeface="+mj-ea"/>'
  + '</a:defRPr></a:lvl1pPr></p:titleStyle><p:bodyStyle><a:lvl1pPr marL="342900" indent="-342900">'
  + '<a:spcBef><a:spcPts val="600"/></a:spcBef><a:buFont typeface="Arial"/><a:buChar char="•"/>'
  + '<a:defRPr sz="2400"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/>'
  + '<a:ea typeface="+mn-ea"/></a:defRPr></a:lvl1pPr></p:bodyStyle>'
  + '<p:otherStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:otherStyle></p:txStyles>';
const COLOR_MAP = '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" '
  + 'accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>';

const MASTER = `${XML_HEAD}<p:sldMaster ${NAMESPACES}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/>`
  + `</p:bgRef></p:bg><p:spTree>${GROUP}${SHAPES}</p:spTree></p:cSld>${COLOR_MAP}`
  + `<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>${TEXT_STYLES}</p:sldMaster>`;

const LAYOUT = `${XML_HEAD}<p:sldLayout ${NAMESPACES} type="obj" preserve="1"><p:cSld name="标题和内容">`
  + `<p:spTree>${GROUP}${SHAPES}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;

function paragraphs(lines: readonly string[]): string {
  if (lines.length === 0) {
    return EMPTY_TEXT;
  }
  return lines.map((line) => `<a:p><a:r><a:rPr lang="zh-CN" dirty="0"/><a:t>${xmlEscape(line)}</a:t></a:r></a:p>`)
    .join('');
}

function pictureXml(image: ImageData, left: number): string {
  const boxW = SLIDE_W - MARGIN - left;
  const scale = Math.min(boxW / (image.width * EMU_PER_PX), BODY_H / (image.height * EMU_PER_PX), 1);
  const w = Math.round(image.width * EMU_PER_PX * scale);
  const h = Math.round(image.height * EMU_PER_PX * scale);
  return '<p:pic><p:nvPicPr><p:cNvPr id="4" name="图"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr>'
    + '<p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>'
    + `<p:spPr>${xfrm(left, BODY_TOP, w, h)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
}

function slideXml(slide: SlideInput, image: ImageData | null): string {
  const bodyW = image === null ? FULL_W : Math.round((SLIDE_W - 3 * MARGIN) / 2);
  const body = placeholder(3, 'body', { x: MARGIN, y: BODY_TOP, w: bodyW, h: BODY_H }, paragraphs(slide.bullets ?? []));
  const picture = image === null ? '' : pictureXml(image, 2 * MARGIN + bodyW);
  return `${XML_HEAD}<p:sld ${NAMESPACES}><p:cSld><p:spTree>${GROUP}`
    + `${placeholder(2, 'title', TITLE_BOX, paragraphs([slide.title]))}${body}${picture}</p:spTree></p:cSld>`
    + '<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>';
}

/** 几页 → .pptx（16:9）。图只认 PNG、JPEG，别的类型那一页不放图。 */
export function makePptx(slides: readonly SlideInput[]): Buffer {
  const files: ZipFile[] = [];
  const presRels: Relation[] = [
    { id: 'rId1', type: 'slideMaster', target: 'slideMasters/slideMaster1.xml' },
    { id: 'rId2', type: 'theme', target: 'theme/theme1.xml' },
  ];
  const overrides: (readonly [string, string])[] = [
    ['/ppt/presentation.xml', `${MAIN_TYPE}.presentationml.presentation.main+xml`],
    ['/ppt/slideMasters/slideMaster1.xml', `${MAIN_TYPE}.presentationml.slideMaster+xml`],
    ['/ppt/slideLayouts/slideLayout1.xml', `${MAIN_TYPE}.presentationml.slideLayout+xml`],
    ['/ppt/theme/theme1.xml', `${MAIN_TYPE}.theme+xml`],
  ];
  slides.forEach((slide, index) => {
    const n = index + 1;
    const image = slide.image === undefined ? null : imageInfo(slide.image);
    const slideRels: Relation[] = [{ id: 'rId1', type: 'slideLayout', target: '../slideLayouts/slideLayout1.xml' }];
    if (image !== null) {
      files.push({ name: `ppt/media/image${n}.${image.type}`, data: image.data });
      slideRels.push({ id: 'rId2', type: 'image', target: `../media/image${n}.${image.type}` });
    }
    files.push({ name: `ppt/slides/slide${n}.xml`, data: slideXml(slide, image) });
    files.push({ name: `ppt/slides/_rels/slide${n}.xml.rels`, data: relsXml(slideRels) });
    presRels.push({ id: `rId${n + 2}`, type: 'slide', target: `slides/slide${n}.xml` });
    overrides.push([`/ppt/slides/slide${n}.xml`, `${MAIN_TYPE}.presentationml.slide+xml`]);
  });
  const slideIds = slides.map((_, index) => `<p:sldId id="${256 + index}" r:id="rId${index + 3}"/>`).join('');
  const presentation = `${XML_HEAD}<p:presentation ${NAMESPACES} saveSubsetFonts="1">`
    + '<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>'
    + `<p:sldIdLst>${slideIds}</p:sldIdLst><p:sldSz cx="${SLIDE_W}" cy="${SLIDE_H}"/>`
    + '<p:notesSz cx="6858000" cy="9144000"/></p:presentation>';
  return writeZip([
    { name: '[Content_Types].xml', data: contentTypes(overrides) },
    { name: '_rels/.rels', data: packageRels('ppt/presentation.xml') },
    { name: 'ppt/presentation.xml', data: presentation },
    { name: 'ppt/_rels/presentation.xml.rels', data: relsXml(presRels) },
    { name: 'ppt/slideMasters/slideMaster1.xml', data: MASTER },
    { name: 'ppt/slideMasters/_rels/slideMaster1.xml.rels', data: relsXml([
      { id: 'rId1', type: 'slideLayout', target: '../slideLayouts/slideLayout1.xml' },
      { id: 'rId2', type: 'theme', target: '../theme/theme1.xml' },
    ]) },
    { name: 'ppt/slideLayouts/slideLayout1.xml', data: LAYOUT },
    { name: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels', data: relsXml([
      { id: 'rId1', type: 'slideMaster', target: '../slideMasters/slideMaster1.xml' },
    ]) },
    { name: 'ppt/theme/theme1.xml', data: THEME },
    ...files,
  ]);
}
