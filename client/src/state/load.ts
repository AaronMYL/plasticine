// 一块数据读到哪了：没读 / 在读 / 读到了 / 没读成（各页的 store 共用）。
export type LoadStatus = 'idle' | 'loading' | 'ready' | 'failed';
