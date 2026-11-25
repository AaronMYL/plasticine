import type { ScheduleContentRule, ScheduleOutward } from '../../shared/state.ts';

const EMOJI_UNIT = String.raw`\p{Extended_Pictographic}|\p{Emoji_Modifier}|\p{Regional_Indicator}`
  + String.raw`|[\u200d\ufe0f]|[#*0-9]\ufe0f?\u20e3|\[[\p{L}\p{N}]{1,8}\]`;
const EMOJI_ONLY = new RegExp(`^(?:${EMOJI_UNIT})+$`, 'u');
const HAS_PICTOGRAPH = /\p{Extended_Pictographic}|\p{Regional_Indicator}|\[[\p{L}\p{N}]{1,8}\]/u;

export function contentAllowed(rule: ScheduleContentRule, content: string): boolean {
  const text = content.trim();
  if (text === '') {
    return false;
  }
  if (rule.kind === 'emoji') {
    return EMOJI_ONLY.test(text.replace(/\s+/g, '')) && HAS_PICTOGRAPH.test(text);
  }
  return rule.texts.some((allowed) => allowed.trim() === text);
}

export function siteAllowed(site: string, url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch (cause) {
    if (cause instanceof TypeError) {
      return false;
    }
    throw cause;
  }
  return host === site || host.endsWith(`.${site}`);
}

function ruleText(rule: ScheduleContentRule): string {
  return rule.kind === 'emoji' ? '只发表情（不带一个字）' : `只发这几条里的一条（原样）：${rule.texts.join(' / ')}`;
}

export function outwardBrief(outward: ScheduleOutward): string {
  return [
    `这张卡他确认过，以他的名义发：只在 ${outward.site} 上（${outward.channel}），只发给这几位：`
      + `${outward.recipients.join('、')}；${ruleText(outward.content)}；这一次每位最多一条。`,
    '点发送那一下设备会拦下（submit_needs_you）：这时调 schedule_send 照卡放行（带上收件人和这次要发的内容），'
      + '它回一个放行编号，再带 submitAsk=<放行编号> 原样点一次发送。',
    '超出这张卡的（别的人、别的内容、别的网站）不要发：照旧用 page_submit_ask 先问他。',
  ].join('\n');
}

export function reportLabel(report: 'always' | 'failures', outward: boolean): string {
  if (report === 'always') {
    return '每次做完告诉你';
  }
  return outward ? '只在有人发不出去时告诉你' : '只在没做成时告诉你';
}
