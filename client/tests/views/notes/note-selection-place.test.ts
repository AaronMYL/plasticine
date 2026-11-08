import { describe, expect, it } from 'vitest';
import { placeSelectionTools, type SelectionToolsFrame } from '../../../src/views/notes/note-selection-place.ts';

const frame: SelectionToolsFrame = {
  width: 400, height: 44, paneLeft: 300, paneRight: 1200,
  viewportTop: 0, viewportHeight: 900, viewportWidth: 1440, phone: false,
};

function overlaps(top: number, height: number, selection: { top: number; bottom: number }): boolean {
  return top < selection.bottom && top + height > selection.top;
}

describe('选段工具条的位置', () => {
  it('桌面放在选区第一行上方，不挡住选中的任何一行', () => {
    const start = { top: 400, bottom: 428, left: 520 };
    const end = { top: 484, bottom: 512, left: 700 };
    const place = placeSelectionTools(start, end, frame);
    expect(place.top + frame.height).toBeLessThanOrEqual(start.top);
    expect(overlaps(place.top, frame.height, { top: start.top, bottom: end.bottom })).toBe(false);
    expect(place.left).toBe(520);
  });

  it('上方放不下时放到选区最后一行下方', () => {
    const start = { top: 20, bottom: 48, left: 520 };
    const end = { top: 104, bottom: 132, left: 700 };
    const place = placeSelectionTools(start, end, frame);
    expect(place.top).toBeGreaterThanOrEqual(end.bottom);
    expect(place.left).toBe(700);
  });

  it('手机先放在选区下方，让开系统自己的拷贝菜单', () => {
    const phone = { ...frame, width: 374, paneLeft: 0, paneRight: 390, viewportWidth: 390, viewportHeight: 844,
      height: 52, phone: true };
    const start = { top: 400, bottom: 428, left: 40 };
    const end = { top: 456, bottom: 484, left: 200 };
    const place = placeSelectionTools(start, end, phone);
    expect(place.top).toBeGreaterThanOrEqual(end.bottom);
    expect(place.left + phone.width).toBeLessThanOrEqual(390 - 8);
  });

  it('选区比屏幕还高时贴在可见区域内，不跑到屏幕外', () => {
    const start = { top: -300, bottom: -272, left: 520 };
    const end = { top: 1200, bottom: 1228, left: 700 };
    const place = placeSelectionTools(start, end, frame);
    expect(place.top).toBeGreaterThanOrEqual(8);
    expect(place.top + frame.height).toBeLessThanOrEqual(900 - 8);
  });

  it('横向不超出正文栏和屏幕', () => {
    const start = { top: 400, bottom: 428, left: 1180 };
    const place = placeSelectionTools(start, start, frame);
    expect(place.left + frame.width).toBeLessThanOrEqual(1440 - 8);
    expect(placeSelectionTools({ ...start, left: 10 }, start, frame).left).toBe(308);
  });
});
