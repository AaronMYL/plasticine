// 设置 · 浏览器「搜索引擎」（11-12）：地址栏里打的不是网址时用哪个搜；只在这台设备记住。11-14 设置页一种行：一行下拉。

import { useState, type ReactNode } from 'react';
import { readSearchEngine, saveSearchEngine, SEARCH_ENGINE_LABELS, SEARCH_ENGINES } from '../../shell/search-engine.ts';
import { SectionHead } from './section-head.tsx';
import { SettingSelect } from './setting-row.tsx';

const OPTIONS = SEARCH_ENGINES.map((value) => ({ value, label: SEARCH_ENGINE_LABELS[value] }));

export function SearchEngineSection(): ReactNode {
  const [engine, setEngine] = useState(readSearchEngine);
  return (
    <section className="block" aria-labelledby="settings-search-engine">
      <SectionHead id="settings-search-engine" title="搜索引擎" />
      <SettingSelect name="地址栏用哪个搜" tip="地址栏里打的不是网址时用它搜。只在这台设备记住。" value={engine}
        options={OPTIONS} onChange={(value) => {
          saveSearchEngine(value);
          setEngine(value);
        }} />
    </section>
  );
}
