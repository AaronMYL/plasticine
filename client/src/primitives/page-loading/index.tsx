import type { ReactNode } from 'react';
import './styles.css';

export interface PageLoadingProps {
  rows?: number;
  dense?: boolean;
  page?: boolean;
}

const WIDTHS = ['72%', '88%', '56%', '80%', '64%', '92%'];

export function PageLoading({ rows = 5, dense = false, page = false }: PageLoadingProps): ReactNode {
  return (
    <div className={`pl-loading${page ? ' is-page' : ''}${dense ? ' is-dense' : ''}`} role="status"
      aria-label="正在读">
      {Array.from({ length: rows }, (_, index) => (
        <span key={index} className="pl-loading-bar"
          style={{ width: dense ? '100%' : WIDTHS[index % WIDTHS.length] }} />
      ))}
    </div>
  );
}
