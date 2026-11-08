/** 未保存偏好时取设备时区；所有读请求和时间输入共用 Live 中这一份。 */
export function deviceTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}
