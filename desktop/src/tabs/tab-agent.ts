export function shellAgent(fallback: string): string {
  return fallback.replace(/\s(?:Electron|plasticine-desktop|Plasticine)\/\S+/gi, '');
}

export function tabUserAgent(fallback: string): string {
  return shellAgent(fallback).replace(/\bChrome\/(\d+)(?:\.\d+)*/, 'Chrome/$1.0.0.0');
}
