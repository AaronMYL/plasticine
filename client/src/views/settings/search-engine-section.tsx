// 设置 · 浏览器「搜索引擎」（11-12）：地址栏里打的不是网址时用哪个搜。几个固定选项用分段控件；只在这台设备记住。

import { useState, type ReactNode } from 'react';
import { readSearchEngine, saveSearchEngine, SEARCH_ENGINE_LABELS, SEARCH_ENGINES } from '../../shell/search-engine.ts';
import { SectionHead } from './section-head.tsx';

export function SearchEngineSection(): ReactNode {
  const [engine, setEngine] = useState(readSearchEngine);
  return (
    <section className="block" aria-labelledby="settings-search-engine">
      <SectionHead id="settings-search-engine" title="搜索引擎" tip="地址栏里打的不是网址时用它搜。只在这台设备记住。" />
      <div className="segmented" role="group" aria-label="搜索引擎">
        {SEARCH_ENGINES.map((value) => (
          <button key={value} type="button" className="segmented-item" aria-pressed={engine === value}
            onClick={() => {
              saveSearchEngine(value);
              setEngine(value);
            }}>{SEARCH_ENGINE_LABELS[value]}</button>
        ))}
      </div>
    </section>
  );
}
