import type { DeviceActionParams } from './api/index.ts';

export const DEVICE_LANES = ['allow', 'confirm', 'deny'] as const;
export type DeviceLane = (typeof DEVICE_LANES)[number];

export interface LaneDecision {
  lane: DeviceLane;
  /** One sentence for the brain, the card and the record. */
  reason: string;
}

const ALLOW: LaneDecision = { lane: 'allow', reason: '' };

const PAYMENT_WORDS = new RegExp('付款|支付|付钱|买单|结账|下单|购买|买下|订购|下订单|提交订单|转账|汇款|打款|充值|提现|'
  + '发红包|扫码付|\\bpay(?:ment|pal)?\\b|\\bcheckout\\b|\\bpurchase\\b|\\bbuy\\b|place\\s+(?:an\\s+)?order|'
  + '\\btransfer\\b|\\bwire\\b', 'i');
const PAYMENT_HOSTS = ['alipay.com', 'pay.weixin.qq.com', 'wx.tenpay.com', 'tenpay.com', 'paypal.com',
  'checkout.stripe.com', 'pay.google.com', 'pay.apple.com', 'unionpay.com', '95516.com'];
const PAYMENT_PATH = new RegExp('/(?:checkout|pay|payment|payments|cashier|buy|purchase|order/(?:confirm|submit|pay))'
  + '(?:[/?#]|$)', 'i');
const PAYMENT_SCHEMES = /\b(?:alipay|alipays|weixin|wechat|paypal|unionpay)s?:\/\//i;
const PAYMENT_TARGET = new RegExp('checkout|place[-_\\s]?order|submit[-_\\s]?order|pay[-_\\s]?now|buy[-_\\s]?now|'
  + 'purchase|支付|付款|下单|结账|购买|买单|转账|汇款|充值', 'i');
const CARD_FIELD = new RegExp('\\bcc-(?:number|csc|exp|exp-month|exp-year|name|type)\\b|card[-_]?(?:number|no)|'
  + '\\bcvv\\b|\\bcvc\\b|卡号|安全码|有效期', 'i');
const ID_PHOTO = /身份证|护照|驾驶证|驾照|银行卡|社保卡|户口|id[-_ ]?card|passport|driver'?s?[-_ ]?licen[cs]e|bank[-_ ]?card/i;
const PASSWORD_FIELD = /type\s*=\s*["']?password|passw(?:or)?d|\bpwd\b|passcode|密码|口令/i;
const CARD_NUMBER = /(?:\d[ -]?){13,19}/g;

const SECRET_PATHS = [/(?:^|\/)\.ssh(?:\/|$)/, /Library\/Keychains(?:\/|$)/, /(?:^|\/)\.gnupg(?:\/|$)/,
  /(?:^|\/)Login Data(?: For Account)?$/, /(?:^|\/)logins\.json$/, /(?:^|\/)key[34]\.db$/, /(?:^|\/)\.netrc$/,
  /(?:^|\/)\.aws\/credentials$/, /(?:^|\/)\.git-credentials$/, /(?:^|\/)\.docker\/config\.json$/,
  /1Password|Bitwarden|KeePass/i];
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

export function isPaymentPage(url: string): boolean {
  return paymentUrl(url);
}

function paymentUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch (error) {
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
    case 'tab_type':
      if (hasCardNumber(action.text)) { return deny('要打的像银行卡号'); }
      return saysPayment ? deny('用途是付款、下单或转账') : null;
    case 'tab_point':
      return saysPayment ? deny('用途是付款、下单或转账') : null;
    case 'tab_paste':
      if (hasCardNumber(action.text)) { return deny('要粘的像银行卡号'); }
      return saysPayment ? deny('用途是付款、下单或转账') : null;
    case 'tab_act':
      if (action.act.op === 'fill' && hasCardNumber(action.act.value)) { return deny('要填的像银行卡号'); }
      return null;
    case 'shortcut_run':
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
    case 'file_fetch':
    case 'file_put':
      return SECRET_PATHS.some((pattern) => pattern.test(action.path)) ? confirm('碰到钥匙串、密码或密钥文件') : null;
    case 'tab_upload':
      return action.files.some((file) => ID_PHOTO.test(file.name)) ? confirm('要上传的像证件或银行卡的照片') : null;
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
    case 'clipboard_read':
      return confirm('要读你剪贴板里现有的东西');
    case 'app_script':
      return SETTINGS_WORDS.test(purpose) || /keystroke|key code|password|密码|System Events/i.test(action.script)
        ? confirm('脚本会模拟按键、碰密码或改系统设置') : null;
    case 'input_key':
    case 'input_scroll':
    case 'input_mouse':
    case 'window_act':
    case 'app_menu':
      return SETTINGS_WORDS.test(purpose) ? confirm('用途是在系统设置或密码里操作') : null;
    case 'app_act':
      return SETTINGS_APPS.test(action.app.trim()) || SETTINGS_WORDS.test(purpose)
        ? confirm('要在系统设置或密码管理里操作') : null;
    case 'open_in_app':
      return action.app !== null && SETTINGS_APPS.test(action.app.trim()) ? confirm('要打开系统设置或密码管理') : null;
    default:
      return null;
  }
}

/** Which lane the action goes down, from what it is for and its parameters; stricter when unsure. */
export function classifyLane(action: DeviceActionParams, purpose: string): LaneDecision {
  return paymentLane(action, purpose) ?? secretLane(action, purpose) ?? ALLOW;
}
