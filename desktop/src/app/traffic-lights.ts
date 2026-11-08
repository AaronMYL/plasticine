// Mac 红绿灯摆在哪、界面左边要让出多宽（11-08《第 7 批》第 1 条，照 ChatGPT 桌面版：窗口最上面一条 44 高的标题栏）。
// 三个灯在标题栏里竖直居中，离左边 20；← 按钮离最后一个灯 14。灯的大小 Electron 量不到，按系统大版本取：
// macOS 26 起按钮中心间距 24pt、三个灯总宽 62pt；之前 14 宽、间隔 6（总宽 54）。用旧 SDK 编的程序在 macOS 26 上读到的
// 系统版本是兼容号 16.x，也按 26 算。

import { TITLEBAR_HEIGHT } from '../../../agent/shared/api/mac-bridge.ts';

/** 灯的直径（两代一样）。 */
const LIGHT_SIZE = 14;
/** 第一个灯离窗口左边。 */
const LEFT = 20;
/** ← 按钮离最后一个灯。 */
const GAP_AFTER = 14;
const WIDTH_TAHOE = 62;
const WIDTH_BEFORE = 54;

export interface TrafficLights {
  /** 给 BaseWindow 的 trafficLightPosition（第一个灯的左上角）。 */
  position: { x: number; y: number };
  /** 标题栏左边让出来的宽度（WindowChrome.trafficLightInset）。 */
  inset: number;
}

function tahoe(systemVersion: string): boolean {
  const major = Number.parseInt(systemVersion.split('.')[0] ?? '', 10);
  return major >= 26 || major === 16;
}

export function macTrafficLights(systemVersion: string): TrafficLights {
  const width = tahoe(systemVersion) ? WIDTH_TAHOE : WIDTH_BEFORE;
  return { position: { x: LEFT, y: (TITLEBAR_HEIGHT - LIGHT_SIZE) / 2 }, inset: LEFT + width + GAP_AFTER };
}
