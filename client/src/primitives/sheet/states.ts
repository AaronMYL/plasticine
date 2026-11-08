// 原语 7 · 浮层 / 抽屉的状态（component-recipes.md「7. 浮层 / 抽屉」）。

/** 开着时里面的内容：就绪 / 加载中 / 失败。关着就什么都不画。 */
export type SheetContentState = 'ready' | 'loading' | 'failed';

/**
 * panel：电脑上浮在主区里，遮罩只盖主区，不是模态（不加 aria-modal、不锁焦点）。
 * drawer：手机上从底部推上、全宽，背后遮罩盖全屏，可以是模态。
 */
export type SheetVariant = 'panel' | 'drawer';
