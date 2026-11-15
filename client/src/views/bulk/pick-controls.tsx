// 「一直能勾」的那几处（11-15 界面统一，Aaron 弹框定，设计稿「多选、加载、空、正在连接」①）：记忆整理、规则搬家、笔记里
// 采用哪几处、建群挑人、编辑群组挑队友、同步抖音收藏夹。打开就能勾，没有「完成」；和资料库那一套用同样三样零件——
// 勾选框（.bulk-check）、顶上「全选 · 已选 n」（三态：一个没勾 · 勾了一部分是一道横 · 全勾）、底下浮条「已选 n」加这件事的
// 主按钮（「采用这 3 条」「建群」「搬这 9 条」）。

import { useEffect, useRef, type ReactNode } from 'react';
import './bulk.css';

/** 顶上一行：全选（三态）和已选几个。onAll(true) 全勾，onAll(false) 全不勾。 */
export function PickAll({ total, picked, onAll, disabled = false, children }: { total: number; picked: number;
  onAll: (on: boolean) => void; disabled?: boolean; children?: ReactNode }): ReactNode {
  const box = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (box.current !== null) box.current.indeterminate = picked > 0 && picked < total;
  }, [picked, total]);
  return (
    <div className="bulk-header pick-head">
      <label className="bulk-all">
        <input ref={box} type="checkbox" className="bulk-check" checked={total > 0 && picked === total}
          disabled={disabled || total === 0} onChange={() => onAll(picked !== total)} />全选
      </label>
      <span className="text-meta">已选 {picked}</span>
      {children}
    </div>
  );
}

/** 底下的浮条：已选几个，后面是这件事的按钮（主按钮放最后）。 */
export function PickBar({ picked, children }: { picked: number; children: ReactNode }): ReactNode {
  return (
    <div className="bulk-bar pick-bar" role="group" aria-label="勾了的">
      <span className="text-meta">已选 {picked}</span>
      {children}
    </div>
  );
}
