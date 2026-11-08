// 2026-11-08 第 6 批第四段：从 agent/src/devices/lanes.ts 挪进 shared，桌面客户端（desktop/）在设备上按同一套判道
// （设备是最后一道墙，第 102 条）。服务端照旧经 devices/lanes.ts 用它。

// 第 102 条：设备动作的三条道——放行 / 要你点 / 关死。分类由代码做，不靠模型自觉：模型交办设备动作时写明用途，
// 这里按用途 + 参数（站点、命令文本、路径、应用、要输入的字）判道；判不准的按更严的道。
// - 关死：付款、下单、转账。直接拒绝，不是门槛高；只能由本人会话确认修改上限放开（payments），云端放不宽。
// - 要你点：读钥匙串与密码（~/.ssh、浏览器密码库、security find-*-password 这类）、改系统设置（defaults write、
//   sudo、systemsetup、tccutil、spctl、在「系统设置」里点），走现有的「要你授权」卡。
// - 放行：其余的，照设备上限执行。只读的动作（列目录以外的读、读网页文字、截图）碰不到付款，不会进关死。
// 网页标签（第 3 批）：开 / 换地址按网址判；点按选择器和按钮上的字判；填按值（卡号）和框（卡号框关死、密码框要你点）判。
// 问这一页按编号操作（tab_act，11-04 第 3 批）：提交（含付款）改成先问他，硬线在注入脚本和 page-submits.ts。
// 设备侧还会按真实 DOM 再判一次（页面地址、表单里有没有密码框、按钮的字），判不准从严。
// - iPhone：运行快捷指令按名字、输入和用途判（快捷指令能付钱、能改设置）；日历、提醒、相册、位置只读写自己的条目，
//   「提醒我付房租」不是付款，照常放行。

import type { DeviceActionParams } from './api/index.ts';

export const DEVICE_LANES = ['allow', 'confirm', 'deny'] as const;
export type DeviceLane = (typeof DEVICE_LANES)[number];

export interface LaneDecision {
  lane: DeviceLane;
  /** One sentence for the brain, the card and the record. */
  reason: string;
}

const ALLOW: LaneDecision = { lane: 'allow', reason: '' };

// 用途里说到付钱、下单、转账（含英文）：判不准就当是。
const PAYMENT_WORDS = new RegExp('付款|支付|付钱|买单|结账|下单|购买|买下|订购|下订单|提交订单|转账|汇款|打款|充值|提现|'
  + '发红包|扫码付|\\bpay(?:ment|pal)?\\b|\\bcheckout\\b|\\bpurchase\\b|\\bbuy\\b|place\\s+(?:an\\s+)?order|'
  + '\\btransfer\\b|\\bwire\\b', 'i');
// 收款、付款页面：主机或路径。
const PAYMENT_HOSTS = ['alipay.com', 'pay.weixin.qq.com', 'wx.tenpay.com', 'tenpay.com', 'paypal.com',
  'checkout.stripe.com', 'pay.google.com', 'pay.apple.com', 'unionpay.com', '95516.com'];
const PAYMENT_PATH = new RegExp('/(?:checkout|pay|payment|payments|cashier|buy|purchase|order/(?:confirm|submit|pay))'
  + '(?:[/?#]|$)', 'i');
const PAYMENT_SCHEMES = /\b(?:alipay|alipays|weixin|wechat|paypal|unionpay)s?:\/\//i;
// 网页标签里要点的按钮、要填的框（选择器或按钮上的字）像付款、下单：选择器里常见连字符写法，单独一条。
const PAYMENT_TARGET = new RegExp('checkout|place[-_\\s]?order|submit[-_\\s]?order|pay[-_\\s]?now|buy[-_\\s]?now|'
  + 'purchase|支付|付款|下单|结账|购买|买单|转账|汇款|充值', 'i');
// 卡号、安全码、有效期框（autocomplete 的 cc-*、常见的 name / id 写法）。
const CARD_FIELD = new RegExp('\\bcc-(?:number|csc|exp|exp-month|exp-year|name|type)\\b|card[-_]?(?:number|no)|'
  + '\\bcvv\\b|\\bcvc\\b|卡号|安全码|有效期', 'i');
// 密码框：type=password，或 name / id 里写着密码。
const PASSWORD_FIELD = /type\s*=\s*["']?password|passw(?:or)?d|\bpwd\b|passcode|密码|口令/i;
// 13–19 位卡号（允许空格、连字符分组），再过 Luhn 校验。
const CARD_NUMBER = /(?:\d[ -]?){13,19}/g;

// 钥匙串、密码库、密钥目录。
const SECRET_PATHS = [/(?:^|\/)\.ssh(?:\/|$)/, /Library\/Keychains(?:\/|$)/, /(?:^|\/)\.gnupg(?:\/|$)/,
  /(?:^|\/)Login Data(?: For Account)?$/, /(?:^|\/)logins\.json$/, /(?:^|\/)key[34]\.db$/, /(?:^|\/)\.netrc$/,
  /(?:^|\/)\.aws\/credentials$/, /(?:^|\/)\.git-credentials$/, /(?:^|\/)\.docker\/config\.json$/,
  /1Password|Bitwarden|KeePass/i];
// 读密码、改系统设置的命令。
const PRIVILEGED_COMMANDS = [
  new RegExp('\\bsecurity\\s+(?:find-(?:generic|internet|certificate|key)|dump-keychain|export|unlock-keychain|'
    + '(?:add|delete)-(?:generic|internet)-password|set-keychain)'),
  /(?:^|[\s;&|(])sudo\b/, /\bdefaults\s+(?:-currentHost\s+)?(?:write|delete|import|rename)\b/,
  /\bsystemsetup\b/, /\btccutil\b/, /\bspctl\b/, /\bcsrutil\b/, /\bfdesetup\b/, /\bnvram\b/, /\bdscl\b/,
  /\bnetworksetup\s+-set/, /\bpmset\b/, /\bscutil\s+--set\b/, /\bkextload\b/, /\bprofiles\s+(?:install|remove)/,
  /\blaunchctl\s+(?:load|unload|bootstrap|bootout|enable|disable)\b/, /x-apple\.systempreferences/,
  /System (?:Settings|Preferences)/,
];
const SETTINGS_APPS = new RegExp('^(?:System Settings|System Preferences|系统设置|系统偏好设置|'
  + 'com\\.apple\\.systempreferences|com\\.apple\\.Settings|Keychain Access|钥匙串访问|com\\.apple\\.keychainaccess|'
  + 'Passwords|密码|com\\.apple\\.Passwords)(?:\\.app)?$', 'i');
const SETTINGS_WORDS = /系统设置|系统偏好|System Settings|System Preferences|钥匙串|密码|口令|password|passcode|keychain|隐私与安全|权限设置/i;

function luhn(digits: string): boolean {
  let sum = 0;
  for (let index = 0; index < digits.length; index += 1) {
    let digit = Number(digits[digits.length - 1 - index]);
    if (index % 2 === 1) {
      digit *= 2;
      if (digit > 9) { digit -= 9; }
    }
    sum += digit;
  }
  return sum % 10 === 0;
}

function hasCardNumber(text: string): boolean {
  return [...text.matchAll(CARD_NUMBER)].some((match) => {
    const digits = match[0].replace(/\D/g, '');
    return digits.length >= 13 && digits.length <= 19 && luhn(digits);
  });
}

/**
 * 付款、收款、下单页面的网址（关死那一道的页面判法）。网页翻译也用它：这类页面不翻（2026-11-03 第 2 批）。
 * 解析不了的网址判不准，当作是。
 */
export function isPaymentPage(url: string): boolean {
  return paymentUrl(url);
}

function paymentUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch (error) {
    // 解析不了的网址判不准，按更严的道。
    if (error instanceof TypeError) { return true; }
    throw error;
  }
  const host = parsed.hostname.toLowerCase();
  return PAYMENT_HOSTS.some((item) => host === item || host.endsWith(`.${item}`)) || PAYMENT_PATH.test(parsed.pathname);
}

function deny(why: string): LaneDecision {
  return { lane: 'deny', reason: `${why}：付款、下单、转账这一类一律不做（关死）；要放开只能在设备上改上限。` };
}

function confirm(why: string): LaneDecision {
  return { lane: 'confirm', reason: `${why}：这一类要你在设备上点一次授权才做。` };
}

function paymentLane(action: DeviceActionParams, purpose: string): LaneDecision | null {
  const saysPayment = PAYMENT_WORDS.test(purpose);
  switch (action.kind) {
    case 'browser_open':
      if (paymentUrl(action.url)) { return deny('打开的是付款或下单页面'); }
      return saysPayment ? deny('用途是付款、下单或转账') : null;
    case 'input_type':
      if (hasCardNumber(action.text)) { return deny('要输入的像银行卡号'); }
      return saysPayment ? deny('用途是付款、下单或转账') : null;
    case 'run_command':
      if (PAYMENT_SCHEMES.test(action.command) || /https?:\/\/\S+/.test(action.command)
        && [...action.command.matchAll(/https?:\/\/\S+/g)].some((match) => paymentUrl(match[0]))) {
        return deny('命令会打开付款或下单入口');
      }
      return saysPayment ? deny('用途是付款、下单或转账') : null;
    case 'input_click':
    case 'app_open':
      return saysPayment ? deny('用途是付款、下单或转账') : null;
    case 'tab_open':
    case 'tab_navigate':
      if (paymentUrl(action.url)) { return deny('要打开的是付款或下单页面'); }
      return saysPayment ? deny('用途是付款、下单或转账') : null;
    case 'tab_click':
      if (PAYMENT_TARGET.test(action.selector ?? '') || PAYMENT_WORDS.test(action.text ?? '')
        || PAYMENT_TARGET.test(action.text ?? '')) {
        return deny('要点的像付款、下单按钮');
      }
      return saysPayment ? deny('用途是付款、下单或转账') : null;
    case 'tab_fill':
      if (hasCardNumber(action.value)) { return deny('要填的像银行卡号'); }
      if (CARD_FIELD.test(action.selector)) { return deny('要填的是银行卡号、安全码或有效期'); }
      return saysPayment ? deny('用途是付款、下单或转账') : null;
    case 'tab_act':
      // 第 3 批（他定）：问这一页里付款、发帖、删除、改设置先问他，不关死——注入脚本按真实元素判出提交就不点，
      // 放行只凭他在要你定卡上选了提交（page-submits.ts）。卡号由他自己填，像卡号的字照旧关死。
      if (action.act.op === 'fill' && hasCardNumber(action.act.value)) { return deny('要填的像银行卡号'); }
      return null;
    case 'shortcut_run':
      // 快捷指令能用 Apple Pay、能开支付宝：名字或用途说到付钱就关死，输入里像卡号或付款入口的也关死。
      if (PAYMENT_WORDS.test(action.name)) { return deny('快捷指令的名字是付款、下单或转账'); }
      if (action.input !== null && (hasCardNumber(action.input) || PAYMENT_SCHEMES.test(action.input))) {
        return deny('交给快捷指令的输入像银行卡号或付款入口');
      }
      return saysPayment ? deny('用途是付款、下单或转账') : null;
    default:
      return null;
  }
}

function secretLane(action: DeviceActionParams, purpose: string): LaneDecision | null {
  switch (action.kind) {
    case 'file_list':
    case 'file_read':
    case 'file_write':
    case 'file_delete':
      return SECRET_PATHS.some((pattern) => pattern.test(action.path)) ? confirm('碰到钥匙串、密码或密钥文件') : null;
    case 'run_command':
      if (PRIVILEGED_COMMANDS.some((pattern) => pattern.test(action.command))) {
        return confirm('命令会读密码或改系统设置');
      }
      return SECRET_PATHS.some((pattern) => pattern.test(action.command)) ? confirm('命令碰到钥匙串、密码或密钥文件')
        : null;
    case 'app_open':
      return SETTINGS_APPS.test(action.app.trim()) ? confirm('要打开系统设置或密码管理') : null;
    case 'input_click':
    case 'input_type':
      return SETTINGS_WORDS.test(purpose) ? confirm('用途是在系统设置或密码里操作') : null;
    case 'tab_fill':
      if (PASSWORD_FIELD.test(action.selector)) { return confirm('要填的是密码框'); }
      return SETTINGS_WORDS.test(purpose) ? confirm('用途是在网页上填密码或改账号设置') : null;
    case 'tab_click':
      return SETTINGS_WORDS.test(purpose) ? confirm('用途是在网页上改密码或账号设置') : null;
    case 'shortcut_run':
      return SETTINGS_WORDS.test(action.name) || SETTINGS_WORDS.test(purpose)
        ? confirm('快捷指令会改系统设置或碰密码') : null;
    default:
      return null;
  }
}

/** Which lane the action goes down, from what it is for and its parameters; stricter when unsure. */
export function classifyLane(action: DeviceActionParams, purpose: string): LaneDecision {
  return paymentLane(action, purpose) ?? secretLane(action, purpose) ?? ALLOW;
}
