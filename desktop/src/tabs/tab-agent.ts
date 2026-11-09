// 网页标签对网站报的 User-Agent（11-09 他：「不能就是 Chrome 的标识吗？」）。Electron 默认带「Electron/…」和应用名，
// Chrome 版本是完整的四段；真 Chrome 自 2023 年起只报主版本（Chrome/156.0.0.0）。去掉这两样之后和同版本的 Chrome
// 一字不差。客户端提示（sec-ch-ua）照 Electron 自己的报「Chromium」，不冒充「Google Chrome」：11-09 对照实验里
// 只报 Chromium 品牌的 Chrome for Testing 照样走完 Google 登录的账号查找，品牌不是被拒的原因。界面自己的
// User-Agent 不走这里的缩短（shellAgent + PlasticineDesktop/<版本>，界面靠它认出桌面客户端）。

/** 去掉 Electron 和应用名（应用名在打包前后分别是 plasticine-desktop / Plasticine）。 */
export function shellAgent(fallback: string): string {
  return fallback.replace(/\s(?:Electron|plasticine-desktop|Plasticine)\/\S+/gi, '');
}

/** 网页标签用的：shellAgent 再把 Chrome 版本缩成主版本。 */
export function tabUserAgent(fallback: string): string {
  return shellAgent(fallback).replace(/\bChrome\/(\d+)(?:\.\d+)*/, 'Chrome/$1.0.0.0');
}
