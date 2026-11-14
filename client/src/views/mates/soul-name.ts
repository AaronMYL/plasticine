// 「卷毛的 Soul」「Plasticine 的 Soul」：名字以字母、数字结尾时空一格（规则搬家、昨晚整理里都这样写）。

export function soulOf(name: string): string {
  return /[A-Za-z0-9]$/u.test(name) ? `${name} 的 Soul` : `${name}的 Soul`;
}

/** 「进卷毛的 Soul」「进 Plasticine 的 Soul」。 */
export function intoSoul(name: string): string {
  return `进${/^[A-Za-z0-9]/u.test(name) ? ' ' : ''}${soulOf(name)}`;
}
