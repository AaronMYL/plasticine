// 网页栏目里没选标签时的主区（「新标签」、点「网页」又没开着的标签）：一个输入框，打网址开网页、打别的字用搜索引擎搜；
// 下面一排工具（记账 · 文件 · 云端浏览器，11-03 定「工具入口在新标签页里」，新标签页并进了这里），再下面是最近关掉的
// 几个，点了重开。桌面客户端里网页开成竖排标签，网页版在新窗口打开。
// 11-13 Aaron：「浏览器的搜索引擎要能在新标签中直接切换」——输入框右边写着现在用哪个搜，点开就换，和设置里是同一份。

import { useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useClientState } from '../../state/context.tsx';
import { useStore } from '../../state/use-store.ts';
import { SiteIcon } from '../../shell/site-icon.tsx';
import { HueTile, type HueName } from '../../shell/hue.tsx';
import { Icon } from '../../shell/icons.tsx';
import { MenuItem, Popover, anchorOf, type PopoverAnchor } from '../../shell/popover.tsx';
import { readSearchEngine, saveSearchEngine, SEARCH_ENGINE_LABELS, SEARCH_ENGINES, type SearchEngine }
  from '../../shell/search-engine.ts';
import { TOOL_ICONS, toolRoute, type ToolName } from '../../shell/routes.ts';
import { useTabActions } from '../../shell/tabs-context.ts';
import { addressToUrl } from '../../shell/use-native-web-tabs.ts';
import './web-start.css';

/** 最近关掉的列几个。 */
const RECENT_SHOWN = 8;

const TOOLS: ReadonlyArray<{ tool: ToolName; label: string; hue: HueName }> = [
  { tool: '记账', label: '记账', hue: 'olive' },
  { tool: '文件', label: '文件', hue: 'teal' },
  { tool: '浏览器', label: '云端浏览器', hue: 'sky' },
];

/** 输入框右边的「必应 ⌄」：点开换搜索引擎。 */
function EnginePick({ engine, onPick }: { engine: SearchEngine; onPick: (engine: SearchEngine) => void }): ReactNode {
  const button = useRef<HTMLButtonElement>(null);
  const [menu, setMenu] = useState<PopoverAnchor | null>(null);
  const close = (): void => setMenu(null);
  return (
    <>
      <button ref={button} type="button" className="web-start-engine" aria-haspopup="menu"
        aria-expanded={menu !== null} aria-label={`搜索引擎：${SEARCH_ENGINE_LABELS[engine]}`}
        onClick={() => setMenu(menu !== null || button.current === null ? null : anchorOf(button.current))}>
        {SEARCH_ENGINE_LABELS[engine]}<Icon name="chevron-down" size={14} />
      </button>
      {menu === null ? null : (
        <Popover anchor={menu} label="搜索引擎" role="menu" align="end" trigger={button} onClose={close}>
          {SEARCH_ENGINES.map((value) => (
            <MenuItem key={value} label={SEARCH_ENGINE_LABELS[value]} checked={value === engine} onSelect={() => {
              close();
              onPick(value);
            }} />
          ))}
        </Popover>
      )}
    </>
  );
}

export function WebStart(): ReactNode {
  const tabs = useTabActions();
  const { webTabs } = useClientState();
  const archived = useStore(webTabs.store).archived.slice(0, RECENT_SHOWN);
  const [text, setText] = useState('');
  const [engine, setEngine] = useState(readSearchEngine);
  const input = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    input.current?.focus({ preventScroll: true });
  }, []);
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    const url = addressToUrl(text);
    if (url !== null) {
      tabs.openWeb(url, text.trim());
      setText('');
    }
  };
  return (
    <div className="page web-start">
      <form className="web-start-form" role="search" onSubmit={submit}>
        <Icon name="globe" size={16} />
        <input ref={input} className="web-start-input" aria-label="网址或要搜的词"
          placeholder={`打网址，或用${SEARCH_ENGINE_LABELS[engine]}搜`}
          value={text} spellCheck={false} autoCapitalize="off" autoCorrect="off" enterKeyHint="go"
          onChange={(event) => setText(event.target.value)} />
        <EnginePick engine={engine} onPick={(value) => {
          saveSearchEngine(value);
          setEngine(value);
          input.current?.focus({ preventScroll: true });
        }} />
      </form>
      <ul className="web-start-tools" aria-label="工具">
        {TOOLS.map((item) => (
          <li key={item.tool}>
            <button type="button" className="web-start-tool" aria-label={item.tool}
              onClick={() => tabs.openTab(toolRoute(item.tool))}>
              <HueTile hue={item.hue} icon={TOOL_ICONS[item.tool]} size={36} />
              <span>{item.label}</span>
            </button>
          </li>
        ))}
      </ul>
      {archived.length === 0 ? null : (
        <section className="web-start-recent" aria-labelledby="web-start-recent">
          <h2 id="web-start-recent" className="web-start-title">最近关掉的</h2>
          <ul>
            {archived.map((entry) => (
              <li key={entry.key}>
                <button type="button" className="web-start-row" onClick={() => tabs.reopenTab(entry.key)}>
                  <SiteIcon url={entry.url} title={entry.title} />
                  <span className="web-start-row-title">{entry.title.trim() === '' ? entry.url : entry.title}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
