import { describe, expect, it } from 'vitest';
import { placeSelectionTools, type SelectionToolsFrame } from '../../../src/views/notes/note-selection-place.ts';

const frame: SelectionToolsFrame = {
  width: 400, height: 44, paneLeft: 300, paneRight: 1200,
  viewportTop: 0, viewportHeight: 900, viewportWidth: 1440, phone: false,
};

function overlaps(top: number, height: number, selection: { top: number; bottom: number }): boolean {
  return top < selection.bottom && top + height > selection.top;
}

describe('Selection toolbar positioning', () => {
  it('desktop places toolbar above first selected line without covering any selection', () => {
    const start = { top: 400, bottom: 428, left: 520 };
    const end = { top: 484, bottom: 512, left: 700 };
    const place = placeSelectionTools(start, end, frame);
    expect(place.top + frame.height).toBeLessThanOrEqual(start.top);
    expect(overlaps(place.top, frame.height, { top: start.top, bottom: end.bottom })).toBe(false);
    expect(place.left).toBe(520);
  });

  it('flips toolbar below last selected line when space above is insufficient', () => {
    const start = { top: 20, bottom: 48, left: 520 };
    const end = { top: 104, bottom: 132, left: 700 };
    const place = placeSelectionTools(start, end, frame);
    expect(place.top).toBeGreaterThanOrEqual(end.bottom);
    expect(place.left).toBe(700);
  });

  it('mobile places toolbar below selection to avoid system copy menu', () => {
    const phone = { ...frame, width: 374, paneLeft: 0, paneRight: 390, viewportWidth: 390, viewportHeight: 844,
      height: 52, phone: true };
    const start = { top: 400, bottom: 428, left: 40 };
    const end = { top: 456, bottom: 484, left: 200 };
    const place = placeSelectionTools(start, end, phone);
    expect(place.top).toBeGreaterThanOrEqual(end.bottom);
    expect(place.left + phone.width).toBeLessThanOrEqual(390 - 8);
  });

  it('pins toolbar inside visible viewport when selection is taller than screen', () => {
    const start = { top: -300, bottom: -272, left: 520 };
    const end = { top: 1200, bottom: 1228, left: 700 };
    const place = placeSelectionTools(start, end, frame);
    expect(place.top).toBeGreaterThanOrEqual(8);
    expect(place.top + frame.height).toBeLessThanOrEqual(900 - 8);
  });

  it('clamps toolbar horizontally within editor column and viewport', () => {
    const start = { top: 400, bottom: 428, left: 1180 };
    const place = placeSelectionTools(start, start, frame);
    expect(place.left + frame.width).toBeLessThanOrEqual(1440 - 8);
    expect(placeSelectionTools({ ...start, left: 10 }, start, frame).left).toBe(308);
  });
});
