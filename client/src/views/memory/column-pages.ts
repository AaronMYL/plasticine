// 一页页往下翻的列表（约定、判断）的本地副本怎么改（纯函数，单独可测）：一栏是一页页接起来的行和下一页的 offset；
// 一行来了新版本就地换，删掉的从栏里拿掉，栏里没有的新行放最上面（新的在前）。版本旧的不往回改。

export interface Column<T> {
  items: readonly T[];
  nextOffset: number | null;
  loadingMore: boolean;
  error: string | null;
}

export function emptyColumn<T>(): Column<T> {
  return { items: [], nextOffset: null, loadingMore: false, error: null };
}

/**
 * 已经读到的行里拿掉了一条（删掉、移去别的分组）：服务端那边它也不在这一列了，后面的每一条往前挪一位，下一页的
 * offset 跟着减一，不然原来排在下一页第一条的会被跳过（审查 5087993 P1）。新放进来的不加：多读到的那一条按 id 去重。
 */
export function shiftAfterRemoval(nextOffset: number | null, removed: number): number | null {
  return nextOffset === null ? null : Math.max(0, nextOffset - removed);
}

/** 一行换上新的；visible 为 false（删掉了）就拿掉。原来没有的、看得见的放最上面。 */
export function placeItem<T extends { id: string }>(column: Column<T>, item: T, visible: boolean): Column<T> {
  const index = column.items.findIndex((existing) => existing.id === item.id);
  if (index < 0) {
    return visible ? { ...column, items: [item, ...column.items] } : column;
  }
  if (!visible) {
    const items = column.items.filter((existing) => existing.id !== item.id);
    return { ...column, items, nextOffset: shiftAfterRemoval(column.nextOffset, 1) };
  }
  const items = [...column.items];
  items[index] = item;
  return { ...column, items };
}

/** 往后翻的一页接在后面，已经有的不重复。 */
export function appendPage<T extends { id: string; version: number }>(
  column: Column<T>,
  page: readonly T[],
  next: number | null,
): Column<T> {
  const known = new Set(column.items.map((item) => item.id));
  const incoming = new Map(page.map((item) => [item.id, item]));
  const items = column.items.map((item) => {
    const next = incoming.get(item.id);
    return next !== undefined && next.version > item.version ? next : item;
  });
  const fresh = page.filter((item) => !known.has(item.id));
  return { items: [...items, ...fresh], nextOffset: next, loadingMore: false, error: null };
}
