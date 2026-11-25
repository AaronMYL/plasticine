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
