// 空间的列表（旧地址 #/books/space）：2026-11-08 起就是资料库首页（#/library，views/library/library-home.tsx）。

import type { ReactNode } from 'react';
import { LibraryHome } from '../library/library-home.tsx';
import type { Route } from '../../shell/routes.ts';
import './spaces.css';

export function SpacesList({ phone = false, navigate }: { phone?: boolean; navigate: (route: Route) => void })
  : ReactNode {
  return <LibraryHome phone={phone} navigate={navigate} />;
}
