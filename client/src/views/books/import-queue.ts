// 图书第二栏栏头的「导入书」：文件在第二栏里选（点击当下才能开文件选择框），导入的进度、出错和核实都在图书馆页上显示
// （library.tsx 的那几行）。这里把选好的文件交给图书馆：图书馆页开着就直接给，还没开就先排着，等它挂上来取走。

type Listener = (files: File[]) => void;

let waiting: File[] = [];
const listeners = new Set<Listener>();

export function queueBookImport(files: readonly File[]): void {
  if (files.length === 0) return;
  if (listeners.size === 0) {
    waiting = [...waiting, ...files];
    return;
  }
  for (const listener of listeners) listener([...files]);
}

/** 图书馆页挂上来时调用：先取走排着的，再接之后的。返回取消订阅。 */
export function onQueuedBookImport(listener: Listener): () => void {
  listeners.add(listener);
  if (waiting.length > 0) {
    const files = waiting;
    waiting = [];
    listener(files);
  }
  return () => {
    listeners.delete(listener);
  };
}
