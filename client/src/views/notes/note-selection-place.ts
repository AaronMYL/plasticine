// 选段工具条（引用 · 润色 · 修改要求）的位置：放在选区之外，不挡住刚选中的字（2026-11-03 用户反馈）。
// 桌面先放在选区第一行上方，放不下再放到最后一行下方；手机反过来，先放下方，因为系统的拷贝菜单在上方。
// 两边都放不下（选区比屏幕还高）就贴在可见区域里离选区开头最近的位置。

export const SELECTION_TOOLS_GAP = 8;

export interface LineBox { top: number; bottom: number; left: number }
export interface SelectionToolsFrame {
  width: number;
  height: number;
  paneLeft: number;
  paneRight: number;
  viewportTop: number;
  viewportHeight: number;
  viewportWidth: number;
  phone: boolean;
}
export interface SelectionToolsPlace { top: number; left: number }

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

export function placeSelectionTools(start: LineBox, end: LineBox, frame: SelectionToolsFrame): SelectionToolsPlace {
  const minTop = frame.viewportTop + SELECTION_TOOLS_GAP;
  const maxTop = frame.viewportTop + frame.viewportHeight - frame.height - SELECTION_TOOLS_GAP;
  const above = { top: start.top - SELECTION_TOOLS_GAP - frame.height, anchor: start.left };
  const below = { top: end.bottom + SELECTION_TOOLS_GAP, anchor: end.left };
  const order = frame.phone ? [below, above] : [above, below];
  const fitting = order.find((option) => option.top >= minTop && option.top <= maxTop);
  const chosen = fitting ?? { top: clamp(above.top, minTop, maxTop), anchor: start.left };
  const minLeft = Math.max(SELECTION_TOOLS_GAP, frame.paneLeft + SELECTION_TOOLS_GAP);
  const maxLeft = Math.min(frame.viewportWidth, frame.paneRight) - frame.width - SELECTION_TOOLS_GAP;
  return { top: chosen.top, left: clamp(chosen.anchor, minLeft, Math.max(minLeft, maxLeft)) };
}
