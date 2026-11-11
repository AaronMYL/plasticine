// 页面和区块在读数据时的占位（第 11 批第一步）：取代各页自己写的「正在读…」。
// - 前 200ms 什么都不画（多数时候数据在这之前就到了，不闪一下）；之后淡入几条和正文同高的灰条，位置和最终内容对齐。
// - rows 是大概有几行；dense 用于列表行（36 高），否则是正文段落（22 高、长短交错）。
// - 有读屏用的「正在读取」，但不常显文字。

import type { ReactNode } from 'react';
import './styles.css';

export interface PageLoadingProps {
  rows?: number;
  dense?: boolean;
  /** 整页（主区）还是一块（第二栏、区块里）。 */
  page?: boolean;
}

const WIDTHS = ['72%', '88%', '56%', '80%', '64%', '92%'];

export function PageLoading({ rows = 5, dense = false, page = false }: PageLoadingProps): ReactNode {
  return (
    <div className={`pl-loading${page ? ' is-page' : ''}${dense ? ' is-dense' : ''}`} role="status"
      aria-label="正在读取">
      {Array.from({ length: rows }, (_, index) => (
        <span key={index} className="pl-loading-bar"
          style={{ width: dense ? '100%' : WIDTHS[index % WIDTHS.length] }} />
      ))}
    </div>
  );
}
