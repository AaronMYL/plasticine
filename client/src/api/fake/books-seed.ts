// 本地开发看「图书」用的预置书：都是公版中文书的开头几段（浮生六记、人间词话、陶庵梦忆、呐喊、庄子），
// 加几条标注、Plasticine 写的大纲和重点。正文是示例，章节 html 和真服务端规范过的一样：块之间没有空白、没有属性。

import type { BookFormat, BookKeyPoint, BookOutline, HighlightColor } from '../shared.ts';

export interface SeedChapter {
  title: string;
  paragraphs: string[];
}

export interface SeedBook {
  id: string;
  title: string;
  author: string;
  format: BookFormat;
  fileName: string;
  chapters: SeedChapter[];
  /** 读到哪（quote 是那一处的原句，空串表示读完了）：没有就是还没读过。 */
  progress?: { chapter: number; quote: string; deviceLabel: string; hoursAgo: number };
  /** 「最近」排序看这个：多少小时前打开过。 */
  openedHoursAgo?: number;
}

export interface SeedAnnotation {
  bookId: string;
  chapter: number;
  quote: string;
  color: HighlightColor;
  note: string | null;
  origin: 'user' | 'plasticine';
  deviceLabel: string | null;
  hoursAgo: number;
}

export interface SeedKeyPoint {
  id: string;
  text: string;
  basis: BookKeyPoint['basis'];
  anchors: { chapter: number; quote: string }[];
}

export const FUSHENG_ID = 'book_fusheng';
export const CIHUA_ID = 'book_cihua';

export const SEED_BOOKS: SeedBook[] = [
  {
    id: FUSHENG_ID,
    title: '浮生六记',
    author: '沈复',
    format: 'epub',
    fileName: '浮生六记.epub',
    progress: { chapter: 0, quote: '芸既长', deviceLabel: 'iPhone', hoursAgo: 12 },
    openedHoursAgo: 12,
    chapters: [
      {
        title: '卷一　闺房记乐',
        paragraphs: [
          '余生乾隆癸未冬十一月二十有二日，正值太平盛世，且在衣冠之家，居苏州沧浪亭畔，天之厚我可谓至矣。'
            + '东坡云：“事如春梦了无痕”，苟不记之笔墨，未免有辜彼苍之厚。',
          '因思《关雎》冠三百篇之首，故列夫妇于首卷，余以次递及焉。所愧少年失学，稍识之无，不过记其实情实事而已。'
            + '若必考订其文法，是责明于垢鉴矣。',
          '余幼聘金沙于氏，八龄而夭。娶陈氏。陈名芸，字淑珍，舅氏心余先生女也。生而颖慧，学语时，口授《琵琶行》，'
            + '即成诵。四龄失怙，母金氏，弟克昌，家徒壁立。芸既长，娴女红，三口仰其十指供给，克昌从师，修脯无缺。',
          '一日，于书簏中得《琵琶行》，挨字而认，始识字。刺绣之暇，渐通吟咏，有“秋侵人影瘦，霜染菊花肥”之句。',
          '余年一十三，随母归宁，两小无嫌，得见所作，虽叹其才思隽秀，窃恐其福泽不深，然心注不能释，告母曰：'
            + '“若为儿择妇，非淑姊不娶。”母亦爱其柔和，即脱金约指缔姻焉。此乾隆乙未七月十六日也。',
          '是年冬，值其堂姊出阁，余又随母往。芸与余同齿而长余十月，自幼姊弟相呼，故仍呼之曰淑姊。',
          '时但见满室鲜衣，芸独通体素淡，仅新其鞋而已。见其绣制精巧，询为己作，始知其慧心不仅在笔墨也。',
          '芸曰：“他年当与君卜筑于此，买绕屋菜园十亩，课仆妪，植瓜蔬，以供薪水。君画我绣，以为诗酒之需。'
            + '布衣菜饭，可乐终身，不必作远游计矣。”',
        ],
      },
      {
        title: '卷二　闲情记趣',
        paragraphs: [
          '余忆童稚时，能张目对日，明察秋毫。见藐小微物，必细察其纹理，故时有物外之趣。',
          '夏蚊成雷，私拟作群鹤舞空，心之所向，则或千或百果然鹤也；昂首观之，项为之强。',
          '又留蚊于素帐中，徐喷以烟，使其冲烟飞鸣，作青云白鹤观，果如鹤唳云端，为之怡然称快。',
        ],
      },
      {
        title: '卷三　坎坷记愁',
        paragraphs: [
          '人生坎坷何为乎来哉？往往皆自作孽耳，余则非也，多情重诺，爽直不羁，转因之为累。',
          '况吾父稼夫公慷慨豪侠，急人之难、成人之事、嫁人之女、抚人之儿，指不胜屈，挥金如土，多为他人。',
        ],
      },
      {
        title: '卷四　浪游记快',
        paragraphs: ['余游幕三十年来，天下所未到者，蜀中、黔中与滇南耳。'],
      },
    ],
  },
  {
    id: CIHUA_ID,
    title: '人间词话',
    author: '王国维',
    format: 'txt',
    fileName: '人间词话.txt',
    progress: { chapter: 3, quote: '此第二境也', deviceLabel: 'Mac', hoursAgo: 72 },
    openedHoursAgo: 72,
    chapters: [
      { title: '第一则', paragraphs: ['词以境界为最上。有境界则自成高格，自有名句。五代、北宋之词所以独绝者在此。'] },
      {
        title: '第二则',
        paragraphs: ['有造境，有写境，此理想与写实二派之所由分。然二者颇难分别。'
          + '因大诗人所造之境，必合乎自然，所写之境，亦必邻于理想故也。'],
      },
      {
        title: '第三则',
        paragraphs: ['有有我之境，有无我之境。“泪眼问花花不语，乱红飞过秋千去。”有我之境也。'
          + '“采菊东篱下，悠然见南山。”无我之境也。'],
      },
      {
        title: '第二十六则',
        paragraphs: [
          '古今之成大事业、大学问者，必经过三种之境界：“昨夜西风凋碧树，独上高楼，望尽天涯路。”此第一境也。'
            + '“衣带渐宽终不悔，为伊消得人憔悴。”此第二境也。'
            + '“众里寻他千百度，蓦然回首，那人却在灯火阑珊处。”此第三境也。',
          '此等语皆非大词人不能道。然遽以此意解释诸词，恐为晏欧诸公所不许也。',
        ],
      },
    ],
  },
  {
    id: 'book_taoan',
    title: '陶庵梦忆',
    author: '张岱',
    format: 'epub',
    fileName: '陶庵梦忆.epub',
    chapters: [{ title: '湖心亭看雪', paragraphs: ['崇祯五年十二月，余住西湖。大雪三日，湖中人鸟声俱绝。'] }],
  },
  {
    id: 'book_nahan',
    title: '呐喊',
    author: '鲁迅',
    format: 'epub',
    fileName: '呐喊.epub',
    progress: { chapter: 0, quote: '', deviceLabel: 'Mac', hoursAgo: 200 },
    openedHoursAgo: 200,
    chapters: [{ title: '自序', paragraphs: ['我在年青时候也曾经做过许多梦，后来大半忘却了，但自己也并不以为可惜。'] }],
  },
  {
    id: 'book_zhuangzi',
    title: '庄子',
    author: '庄周',
    format: 'txt',
    fileName: '庄子.txt',
    chapters: [{ title: '逍遥游', paragraphs: ['北冥有鱼，其名为鲲。鲲之大，不知其几千里也。化而为鸟，其名为鹏。'] }],
  },
];

export const SEED_ANNOTATIONS: SeedAnnotation[] = [
  { bookId: FUSHENG_ID, chapter: 0, quote: '东坡云：“事如春梦了无痕”，苟不记之笔墨，未免有辜彼苍之厚。', color: 'ochre',
    note: '写下来，才不辜负——这就是我记笔记的理由。', origin: 'user', deviceLabel: 'iPhone', hoursAgo: 12 },
  { bookId: FUSHENG_ID, chapter: 0, quote: '芸既长，娴女红，三口仰其十指供给，克昌从师，修脯无缺。', color: 'sage',
    note: null, origin: 'user', deviceLabel: null, hoursAgo: 11.9 },
  { bookId: FUSHENG_ID, chapter: 0, quote: '因思《关雎》冠三百篇之首，故列夫妇于首卷，余以次递及焉。', color: 'slate',
    note: null, origin: 'plasticine', deviceLabel: null, hoursAgo: 11 },
  { bookId: FUSHENG_ID, chapter: 0, quote: '布衣菜饭，可乐终身，不必作远游计矣。', color: 'slate',
    note: '想要的生活其实很小。', origin: 'user', deviceLabel: 'iPhone', hoursAgo: 35 },
  { bookId: FUSHENG_ID, chapter: 1, quote: '余忆童稚时，能张目对日，明察秋毫。', color: 'rose',
    note: null, origin: 'user', deviceLabel: null, hoursAgo: 96 },
  { bookId: CIHUA_ID, chapter: 3, quote: '“衣带渐宽终不悔，为伊消得人憔悴。”', color: 'ochre',
    note: '第二境最难熬。', origin: 'user', deviceLabel: 'Mac', hoursAgo: 72 },
];

export const SEED_OUTLINE: { bookId: string; outline: BookOutline } = {
  bookId: FUSHENG_ID,
  outline: {
    note: '按全书 4 卷（后两卷存疑，不计）逐卷归纳，再合成',
    parts: [
      { chapter: 0, title: '闺房记乐', summary: '和芸从订婚到婚后的日常，写夫妻之乐。',
        points: ['开篇交代为什么写、为什么从夫妇写起', '芸自学识字、能诗', '沧浪亭、萧爽楼的小日子'] },
      { chapter: 1, title: '闲情记趣', summary: '童年的观察、插花盆景、布置居所的趣味。',
        points: ['“物外之趣”：小中见大', '芸参与布置，两人的审美'] },
      { chapter: 2, title: '坎坷记愁', summary: '家庭失和、被逐、贫病，芸去世。',
        points: ['和父母的误会怎样一步步变成决裂', '芸病逝扬州'] },
      { chapter: 3, title: '浪游记快', summary: '各地游历见闻。', points: ['游记里藏着前三卷的情绪'] },
    ],
  },
};

export const SEED_KEY_POINTS: { bookId: string; points: SeedKeyPoint[] } = {
  bookId: FUSHENG_ID,
  points: [
    { id: 'kp1', text: '写这本书是为了给流逝的日子留痕。', basis: 'quoted',
      anchors: [{ chapter: 0, quote: '苟不记之笔墨，未免有辜彼苍之厚。' }] },
    { id: 'kp2', text: '全书按“乐、趣、愁、快”四种情绪分卷，不按时间；开篇就交代从夫妇写起。', basis: 'quoted',
      anchors: [{ chapter: 0, quote: '因思《关雎》冠三百篇之首，故列夫妇于首卷，余以次递及焉。' }] },
    { id: 'kp3', text: '芸靠自学识字、能诗，后文她的性情都从这里起。', basis: 'quoted',
      anchors: [{ chapter: 0, quote: '有“秋侵人影瘦，霜染菊花肥”之句。' },
        { chapter: 0, quote: '始知其慧心不仅在笔墨也。' }] },
    { id: 'kp4', text: '童年的“物外之趣”是全书趣味的底子：小中见大。', basis: 'quoted',
      anchors: [{ chapter: 1, quote: '见藐小微物，必细察其纹理，故时有物外之趣。' }] },
    { id: 'kp5', text: '沈复把坎坷归于“多情重诺，爽直不羁”，对自己的过失写得很少，读卷三时可以留意。',
      basis: 'inferred', anchors: [] },
  ],
};
