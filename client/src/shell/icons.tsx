// 壳用的图标：内联描边 SVG，描边 1.6、常规 16px、页头 17px（visual-foundation「图标」），不引图标库。

import type { ReactNode } from 'react';

export type IconName =
  | 'smile'
  | 'reply'
  | 'arrow-down'
  | 'home'
  | 'forward'
  | 'tabs'
  | 'person'
  | 'hash'
  | 'thread'
  | 'today'
  | 'conversation'
  | 'tasks'
  | 'concerns'
  | 'memory'
  | 'notes'
  | 'books'
  | 'toc'
  | 'feed'
  | 'device'
  | 'tools'
  | 'bell'
  | 'sidebar'
  | 'more'
  | 'back'
  | 'paperclip'
  | 'search'
  | 'plus'
  | 'close'
  | 'chevron-down'
  | 'chevron-right'
  | 'chevron-up'
  | 'send'
  | 'stop'
  | 'copy'
  | 'edit'
  | 'trash'
  | 'history'
  | 'undo'
  | 'redo'
  | 'check'
  | 'refresh'
  | 'download'
  | 'phone'
  | 'upload'
  | 'folder'
  | 'sparkle'
  | 'sparkles'
  | 'quote'
  | 'expand'
  | 'collapse'
  | 'pin'
  | 'bookmark'
  | 'region'
  | 'star'
  | 'star-filled'
  | 'heart'
  | 'heart-filled'
  | 'skip'
  | 'link'
  | 'sun'
  | 'moon'
  | 'filter'
  | 'sort'
  | 'bold'
  | 'italic'
  | 'list'
  | 'list-ordered'
  | 'table'
  | 'image'
  | 'code'
  | 'chart'
  | 'wallet'
  | 'pulse'
  | 'play'
  | 'bulb'
  | 'timer'
  | 'globe'
  | 'translate'
  | 'file'
  | 'sliders'
  | 'keyboard'
  | 'lock'
  | 'mail'
  | 'panel-right'
  | 'external'
  | 'settings'
  | 'info'
  | 'shield'
  | 'eye'
  | 'terminal'
  | 'clock'
  | 'alert'
  | 'pause'
  | 'mac'
  | 'cloud'
  | 'play'
  | 'grip'
  | 'library'
  | 'space'
  | 'users'
  | 'column-collapse'
  | 'column-expand';

const SPARKLES = <path d="m8 1.5 1.7 4.8L14.5 8l-4.8 1.7L8 14.5l-1.7-4.8L1.5 8l4.8-1.7z" />;

const PATHS: Record<IconName, ReactNode> = {
  search: <><circle cx="7" cy="7" r="4.5" /><path d="m10.5 10.5 3 3" /></>,
  plus: <path d="M8 3v10M3 8h10" />,
  // 拖动把手：两列三行的点（心跳清单那样能拖的行）。
  // 两层侧栏（11-07 设计稿）：资料库（书架）、空间（报告）、群。
  library: <path d="M3 2.5v11M6 2.5v11M9.1 2.9l3.4 10.4" />,
  space: <>
    <rect x="2.5" y="2" width="11" height="12" rx="1.5" />
    <path d="M5.5 11V8.5M8 11V5.5M10.5 11V9" />
  </>,
  users: <>
    <circle cx="6" cy="5.5" r="2.3" />
    <path d="M1.8 13a4.2 4.2 0 0 1 8.4 0M10.6 3.4a2.3 2.3 0 0 1 0 4.4M12 9.3a4.2 4.2 0 0 1 2.2 3.7" />
  </>,
  // 第二栏收起 / 展开（11-08，参考图「≡‹」「›≡」）：三道横线，箭头指向收起 / 展开的方向。
  'column-collapse': <path d="M2 4h7M2 8h5M2 12h7M13.5 5 10.5 8l3 3" />,
  'column-expand': <path d="M7 4h7M9 8h5M7 12h7M2.5 5l3 3-3 3" />,
  grip: <path d="M6 4h.01M10 4h.01M6 8h.01M10 8h.01M6 12h.01M10 12h.01" strokeWidth="2.2" />,
  home: <path d="M2.5 7.5 8 3l5.5 4.5M4 6.5v7h3v-4h2v4h3v-7" />,
  forward: <path d="M6 3.5 10.5 8 6 12.5" />,
  tabs: <><rect x="2.5" y="4.5" width="9" height="9" rx="1.5" /><path d="M5 2.5h7a1.5 1.5 0 0 1 1.5 1.5v7" /></>,
  person: <><circle cx="8" cy="5.5" r="2.5" /><path d="M3 13.5a5 5 0 0 1 10 0" /></>,
  hash: <path d="M6 2.5 5 13.5M11 2.5l-1 11M3 6h10.5M2.5 10H13" />,
  thread: <path d="M3 3.5h10v6.5H7.5L4.5 12.5V10H3z" />,
  play: <path d="M5 3.2v9.6L12.5 8z" />,
  close: <path d="m4 4 8 8M12 4l-8 8" />,
  info: <><circle cx="8" cy="8" r="6" /><path d="M8 7.25V11M8 5h.01" /></>,
  'chevron-down': <path d="m4 6 4 4 4-4" />,
  'chevron-right': <path d="m6 4 4 4-4 4" />,
  'chevron-up': <path d="m4 10 4-4 4 4" />,
  send: <path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" />,
  stop: <rect x="4" y="4" width="8" height="8" rx="1" />,
  copy: <><rect x="6" y="6" width="7.5" height="7.5" rx="1.5" /><path d="M10 3H4a1 1 0 0 0-1 1v6" /></>,
  edit: <path d="m10.5 2.5 3 3-7.5 7.5H3v-3zM9 4l3 3" />,
  trash: <path d="M2.5 4.5h11M6 4.5v-2h4v2M4 4.5l.7 9h6.6l.7-9M6.5 7v4M9.5 7v4" />,
  history: <><path d="M3 5a5.5 5.5 0 1 1-.4 5M2 2.5V6h3.5M8 4.5v4l2.5 1.5" /></>,
  undo: <path d="M5 3 2 6l3 3M2 6h7a4 4 0 0 1 0 8" />,
  smile: <><circle cx="8" cy="8" r="5.75" /><path d="M5.75 9.5a2.75 2.75 0 0 0 4.5 0M6 6.25v.5M10 6.25v.5" /></>,
  reply: <path d="M6.5 4 3 7.5 6.5 11M3 7.5h6.5a3.5 3.5 0 0 1 3.5 3.5v1" />,
  'arrow-down': <path d="M8 3v10M3.5 8.5 8 13l4.5-4.5" />,
  redo: <path d="m11 3 3 3-3 3M14 6H7a4 4 0 0 0 0 8" />,
  check: <path d="m3 8 3 3 7-7" />,
  refresh: <path d="M13.5 6A5.5 5.5 0 0 0 3 4.5L2.5 7M2.5 3v4h4M2.5 10a5.5 5.5 0 0 0 10.5 1.5l.5-2.5M9.5 9h4v4" />,
  download: <path d="M8 2v8M5 7l3 3 3-3M3 11v2.5h10V11" />,
  phone: <><rect x="4.5" y="1.5" width="7" height="13" rx="1.5" /><path d="M7.3 12.3h1.4" /></>,
  upload: <path d="M8 10V2M5 5l3-3 3 3M3 11v2.5h10V11" />,
  folder: <path d="M2 5V3.5h4L8 5h6v8H2z" />,
  sparkle: SPARKLES,
  sparkles: SPARKLES,
  quote: <path d="M2.5 3.5h4V8h-3c0 2 1 3.5 3 4.5M9.5 3.5h4V8h-3c0 2 1 3.5 3 4.5" />,
  expand: <path d="M9.5 2.5h4v4M13.5 2.5l-4 4M6.5 13.5h-4v-4M2.5 13.5l4-4" />,
  collapse: <path d="M13.5 6.5h-4v-4M9.5 6.5l4-4M2.5 9.5h4v4M6.5 9.5l-4 4" />,
  pin: <path d="m10 2 4 4-3 1-3 4-1-2-2-1 4-3zM7 9l-5 5" />,
  bookmark: <path d="M4 2.5h8v11l-4-3-4 3z" />,
  // 圈一块（第 2 批「浏览器」）：三个取景角 + 指针。
  region: <path d="M2.7 6V3.3a.6.6 0 0 1 .6-.6H6M10 2.7h2.7a.6.6 0 0 1 .6.6V6M2.7 10v2.7a.6.6 0 0 0 .6.6H6
    M8.7 8.7l5 2-2.1.8-.9 2.2z" />,
  // 书签（第 110 条）：空心 = 没加，实心 = 已加。
  star: <path d="m8 2 1.8 3.7 4 .6-2.9 2.8.7 4L8 11.2l-3.6 1.9.7-4-2.9-2.8 4-.6z" />,
  'star-filled': <path d="m8 2 1.8 3.7 4 .6-2.9 2.8.7 4L8 11.2l-3.6 1.9.7-4-2.9-2.8 4-.6z" fill="currentColor" />,
  // 赞（信息流卡底，11-04）：空心 = 没赞，实心 = 赞了。
  heart: <path d="M8 13.5 2.7 8.2A3.5 3.5 0 0 1 8 3.8a3.5 3.5 0 0 1 5.3 4.4z" />,
  'heart-filled': <path d="M8 13.5 2.7 8.2A3.5 3.5 0 0 1 8 3.8a3.5 3.5 0 0 1 5.3 4.4z" fill="currentColor" />,
  skip: <><circle cx="8" cy="8" r="5.5" /><path d="m4 4 8 8" /></>,
  link: <path d="m6 10 4-4M5.5 7.5 3 10a2.1 2.1 0 0 0 3 3l2.5-2.5M7.5 5.5 10 3a2.1 2.1 0 0 1 3 3l-2.5 2.5" />,
  sun: <><circle cx="8" cy="8" r="3" /><path d="M8 1v1M8 14v1M1 8h1M14 8h1M3 3l1 1M12 12l1 1M3 13l1-1M12 4l1-1" /></>,
  moon: <path d="M13.5 9a5.7 5.7 0 0 1-6.5-6.5 5.7 5.7 0 1 0 6.5 6.5z" />,
  filter: <path d="M2 3h12l-4.5 5v5l-3-1V8z" />,
  sort: <path d="M5 3v10M2.5 5.5 5 3l2.5 2.5M11 3v10M8.5 10.5 11 13l2.5-2.5" />,
  bold: <path d="M4.5 2.5H9a2.5 2.5 0 0 1 0 5H4.5V13h5a2.75 2.75 0 0 0 0-5.5h-5z" />,
  italic: <path d="M7 2.5h5M4 13.5h5M10 2.5 6 13.5" />,
  list: <path d="M6 4h7M6 8h7M6 12h7M2.5 4h.1M2.5 8h.1M2.5 12h.1" />,
  'list-ordered': <path d="M6 4h7M6 8h7M6 12h7M2 2.5h1v3M2 8a1 1 0 1 1 1 1l-1 2h2" />,
  table: <><rect x="2" y="2.5" width="12" height="11" rx="1.5" /><path d="M2 6h12M2 10h12M6 6v7.5M10 6v7.5" /></>,
  image: <><rect x="2" y="2.5" width="12" height="11" rx="1.5" /><circle cx="5.5" cy="6" r="1" />
    <path d="m2 11 3-3 3 3 3-4 3 4" /></>,
  code: <path d="M5 4 1.5 8 5 12M11 4l3.5 4-3.5 4M9 2 7 14" />,
  chart: <path d="M2.5 2v11.5H14M5 10V7M8.5 10V4M12 10V6" />,
  // 任务栏目（《优化清单》第 3、5 条）：心跳、建议（灯泡）；「到点去做」用上面的 play。
  pulse: <path d="M1.5 8.5h3l1.5-3 2.5 6 2-4.5 1 1.5h3" />,
  bulb: <path d={'M6 12.5h4M6.5 14.5h3M8 1.5a4.5 4.5 0 0 0-2.6 8.2c.4.3.6.8.6 1.3v.5h4v-.5'
    + 'c0-.5.2-1 .6-1.3A4.5 4.5 0 0 0 8 1.5z'} />,
  wallet: <><path d="M12 4V2.5H4A1.5 1.5 0 0 0 2.5 4v8A1.5 1.5 0 0 0 4 13.5h9.5V4z" />
    <path d="M13.5 7H10v3h3.5M11.5 8.5h.1" /></>,
  timer: <><circle cx="8" cy="9" r="5" /><path d="M6 1.5h4M8 1.5V4M12 4l1-1M8 6v3l2 1" /></>,
  globe: <><circle cx="8" cy="8" r="5.5" /><ellipse cx="8" cy="8" rx="2.5" ry="5.5" />
    <path d="M2.5 8h11" /></>,
  // 文A：网页工具条上的沉浸式翻译（照 Lucide languages 的写法缩到 16 格）。
  translate: <path d="M3.3 5.3l4 4M2.7 9.3l4-4 1.3-2M1.3 3.3h8M4.7 1.3h.7M14.7 14.7l-3.3-6.7-3.3 6.7M9.3 12h4" />,
  file: <path d="M9 2.5H3.5v11h9V6zM9 2.5V6h3.5M6 9h4M6 11h3" />,
  sliders: <><path d="M2 4.5h5M10 4.5h4M2 11.5h2M7 11.5h7" />
    <circle cx="8.5" cy="4.5" r="1.5" /><circle cx="5.5" cy="11.5" r="1.5" /></>,
  keyboard: <><rect x="1.5" y="4" width="13" height="8" rx="1.5" />
    <path d="M4 6.5h.1M6.5 6.5h.1M9 6.5h.1M11.5 6.5h.1M4 9.5h1M7 9.5h5" /></>,
  paperclip: <path d="m6 8 4-4a2 2 0 0 1 3 3L7 13a3.5 3.5 0 0 1-5-5l6-6M4.5 9.5l6-6" />,
  today: (
    <>
      <rect x="2.5" y="3.5" width="11" height="10" rx="2" />
      <path d="M2.5 6.5h11M5.5 2v3M10.5 2v3" />
    </>
  ),
  conversation: (
    <path d="M3 4.5A1.5 1.5 0 0 1 4.5 3h7A1.5 1.5 0 0 1 13 4.5v5a1.5 1.5 0 0 1-1.5 1.5H7l-3 2.5V11z" />
  ),
  tasks: (
    <>
      <path d="M3 4.5l1.2 1.2L6.5 3.5M3 10.5l1.2 1.2 2.3-2.2" />
      <path d="M8.5 5h4.5M8.5 11h4.5" />
    </>
  ),
  concerns: (
    <>
      <circle cx="8" cy="8" r="5.5" />
      <circle cx="8" cy="8" r="2" />
    </>
  ),
  memory: <path d="M8 2.5l5.5 3-5.5 3-5.5-3zM2.5 8.5l5.5 3 5.5-3M2.5 11l5.5 3 5.5-3" />,
  notes: <path d="M10.5 2.5l3 3-7.5 7.5H3v-3zM9 4l3 3" />,
  // 摊开的一本书：图书页（用户 2026-11-01 定）。
  books: <path d="M8 4.2C6.4 3 4.4 2.7 2.5 3.2v9.3c1.9-.5 3.9-.2 5.5 1M8 4.2c1.6-1.2 3.6-1.5 5.5-1v9.3
    c-1.9-.5-3.9-.2-5.5 1M8 4.2v9.3" />,
  // 目录：两行长、一行短。
  toc: <path d="M3 4h10M3 8h10M3 12h6" />,
  feed: <path d="M3 3.5h10M3 8h10M3 12.5h6" />,
  device: (
    <>
      <rect x="2.5" y="3" width="11" height="7.5" rx="1.5" />
      <path d="M6 13.5h4M8 10.5v3" />
    </>
  ),
  tools: <path d="M9.5 3a3 3 0 0 0 3.4 4L8 11.9 5.6 14.3a1.4 1.4 0 0 1-2-2L6 9.9 10.9 5a3 3 0 0 0-1.4-2z" />,
  bell: <path d="M4 11.5V7.5a4 4 0 0 1 8 0v4l1 1.5H3zM6.5 14.5h3" />,
  sidebar: (
    <>
      <rect x="2.5" y="3" width="11" height="10" rx="2" />
      <path d="M6.5 3v10" />
    </>
  ),
  more: <path d="M3.5 8h.01M8 8h.01M12.5 8h.01" />,
  lock: <><rect x="3.5" y="7" width="9" height="7" rx="1.5" /><path d="M5.5 7V4.5a2.5 2.5 0 0 1 5 0V7" /></>,
  back: <path d="M10 3.5L5.5 8l4.5 4.5" />,
  // 信封：联系人里的邮件（第 113 条）。
  mail: <><rect x="2" y="3.5" width="12" height="9" rx="1.5" /><path d="m2.5 4.5 5.5 4.5 5.5-4.5" /></>,
  // 方框带斜出的箭头：到别处打开（邮件「在 Gmail 打开」）。
  external: <path d="M9.5 2.5h4v4M13.5 2.5 8 8M12 9.5V13a.5.5 0 0 1-.5.5h-8A.5.5 0 0 1 3 13V5a.5.5 0 0 1 .5-.5H7" />,
  // 右边一栏：联系人的资料栏开关。
  'panel-right': <><rect x="2.5" y="3" width="11" height="10" rx="2" /><path d="M9.5 3v10" /></>,
  settings: (
    <>
      <circle cx="8" cy="8" r="2.2" />
      <path d="M8 1.8v1.8M8 12.4v1.8M1.8 8h1.8M12.4 8h1.8M3.6 3.6l1.3 1.3M11.1 11.1l1.3 1.3M3.6 12.4l1.3-1.3" />
      <path d="M11.1 4.9l1.3-1.3" />
    </>
  ),
  // 2026-11-05 设计稿（Harness 重做）：步骤的图标、排队的钟、出错提示、暂停、设备里的 Mac。
  shield: (
    <><path d="M8 1.8 13 3.6v4.1c0 3-2.1 5.4-5 6.5-2.9-1.1-5-3.5-5-6.5V3.6z" /><path d="m5.8 8 1.6 1.6 3-3.1" /></>
  ),
  eye: <><path d="M1.8 8S4 3.8 8 3.8 14.2 8 14.2 8 12 12.2 8 12.2 1.8 8 1.8 8z" /><circle cx="8" cy="8" r="1.9" /></>,
  terminal: <><rect x="1.8" y="2.8" width="12.4" height="10.4" rx="1.6" /><path d="m4.5 6.2 2 1.8-2 1.8M8 10h3.5" /></>,
  clock: <><circle cx="8" cy="8" r="5.5" /><path d="M8 5v3.2l2 1.3" /></>,
  alert: <><circle cx="8" cy="8" r="6" /><path d="M8 4.8v3.8M8 11.1h.01" /></>,
  pause: <path d="M6 4.5v7M10 4.5v7" />,
  mac: <><rect x="2.5" y="3" width="11" height="7.5" rx="1.2" /><path d="M1 12.5h14" /></>,
  cloud: <path d="M4.5 12.5h7a3 3 0 0 0 .4-6 4 4 0 0 0-7.7 1 2.5 2.5 0 0 0 .3 5Z" />,
};

export function Icon({ name, size = 16 }: { name: IconName; size?: number }): ReactNode {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}
