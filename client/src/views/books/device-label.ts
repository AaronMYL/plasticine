// 阅读进度带的设备名：「iPhone 上读到卷二」。只是给人看的，按浏览器自报的 userAgent 猜；猜不出就写「浏览器」。
// iPadOS 的 Safari 自称 Macintosh，靠多点触控分出来。

export function deviceLabelOf(userAgent: string, maxTouchPoints = 0): string {
  if (/iPhone|iPod/.test(userAgent)) {
    return 'iPhone';
  }
  if (/iPad/.test(userAgent) || /Macintosh/.test(userAgent) && maxTouchPoints > 1) {
    return 'iPad';
  }
  if (/Android/.test(userAgent)) {
    return 'Android';
  }
  if (/Macintosh|Mac OS X/.test(userAgent)) {
    return 'Mac';
  }
  if (/Windows/.test(userAgent)) {
    return 'Windows';
  }
  return '浏览器';
}

export function currentDeviceLabel(): string {
  if (typeof navigator === 'undefined') {
    return '浏览器';
  }
  return deviceLabelOf(navigator.userAgent, navigator.maxTouchPoints);
}
