import type { ReactNode } from 'react';
import type { PlasticineIOSBridge } from '../../api/shared.ts';
import '../../ios/bridge.ts';
import { hostIosPages, inDesktopApp } from '../../shell/host.ts';
import { SectionHead } from './section-head.tsx';

export function installationSteps(userAgent: string): string {
  if (/iPhone|iPad|iPod/.test(userAgent)) {
    return '在 Safari 点「分享」→「添加到主屏幕」。从新图标打开后没有地址栏，也能打开系统通知。';
  }
  if (/Android/.test(userAgent)) {
    return '在 Chrome 菜单点「安装应用」或「添加到主屏幕」，再从 Plasticine 图标打开。';
  }
  return '在 Chrome 或 Edge 地址栏点安装图标；Safari 可从「文件」选择「添加到程序坞」。从图标打开是独立窗口。';
}

// iPhone App 里不用「添加到主屏幕」：换成三个原生页面入口（ios/ 的设置与自检、拍照、语音）。
function IosSection({ bridge }: { bridge: PlasticineIOSBridge }): ReactNode {
  return <section className="block">
    <SectionHead title="iPhone App" tip="配对、授权的文件夹和地点、各项能力能不能用，都在原生的设置与自检里。" />
    <div className="settings-ios-actions">
      <button type="button" className="chip-button" onClick={() => bridge.open('settings')}>设置与自检</button>
      <button type="button" className="chip-button" onClick={() => bridge.open('photo')}>拍照交给 Plasticine</button>
      <button type="button" className="chip-button" onClick={() => bridge.open('voice')}>说给 Plasticine</button>
    </div>
  </section>;
}

export function InstallSection(): ReactNode {
  const bridge = hostIosPages();
  if (bridge !== null) {
    return <IosSection bridge={bridge} />;
  }
  // Mac App 本身就是装好的客户端，「装到主屏幕」那句对它没用（2026-11-04 第 3 批打磨）。
  if (inDesktopApp()) {
    return null;
  }
  // 怎么装是补充说明，收进标题后的 ⓘ（《优化清单》第 12 条那一批：常显的那段说明改成 ⓘ）。
  return <section className="block" aria-labelledby="settings-install">
    <SectionHead id="settings-install" title="装到主屏幕" tip={installationSteps(navigator.userAgent)} />
  </section>;
}
