// 设置 · 通用 · 动态背景（11-13 Aaron）：总开关；开着时形象（下拉，海里 / 天上 / 地上 / 赛博各一组）、速度、透明度、
// 显示在哪几页（下拉，多选）。点了马上生效，只在这台设备记住。11-13 看过设计稿后 Aaron 定：选项不平铺，用下拉框选。
// 11-14 设置页一种行（Aaron 弹框选）：右边只放开关、下拉、按钮，速度和透明度从滑杆改成几档下拉，小样去掉（背景就在后面）。

import type { ReactNode } from 'react';
import { AMBIENT_GROUPS, FIGURES, figureById, GROUP_LABELS, type FigureId } from '../../shell/ambient/figures.ts';
import { AMBIENT_PAGE_LABELS, AMBIENT_PAGES, ambientStore, saveAmbient,
  type AmbientSettings } from '../../shell/ambient/settings.ts';
import { DropdownMenu, SEPARATOR, type DropdownEntry } from '../../shell/dropdown-menu.tsx';
import { Icon } from '../../shell/icons.tsx';
import { useStore } from '../../state/use-store.ts';
import { SettingRow, SettingSelect, SettingSwitch, type SelectOption } from './setting-row.tsx';

const TIP = '鼠标划过会惊动它们，点一下会散开；字后面自动压淡，不挡阅读。只在这台设备记住。';

function figureItems(current: FigureId): DropdownEntry[] {
  const entries: DropdownEntry[] = [];
  for (const group of AMBIENT_GROUPS) {
    if (entries.length > 0) entries.push(SEPARATOR);
    for (const figure of FIGURES.filter((one) => one.group === group)) {
      entries.push({ label: figure.label, checked: figure.id === current,
        onSelect: () => saveAmbient({ figure: figure.id }) });
    }
  }
  return entries;
}

function pageItems(pages: AmbientSettings['pages']): DropdownEntry[] {
  return AMBIENT_PAGES.map((page) => ({
    label: AMBIENT_PAGE_LABELS[page], checked: pages[page], keepOpen: true,
    onSelect: () => saveAmbient({ pages: { ...pages, [page]: !pages[page] } }),
  }));
}

/** 下拉按钮上写的：全开写「全部页面」，三页以内写名字，再多写页数。 */
function pagesSummary(pages: AmbientSettings['pages']): string {
  const on = AMBIENT_PAGES.filter((page) => pages[page]);
  if (on.length === AMBIENT_PAGES.length) return '全部页面';
  if (on.length === 0) return '哪页都不显示';
  return on.length <= 3 ? on.map((page) => AMBIENT_PAGE_LABELS[page]).join('、') : `${on.length} 页`;
}

/** 速度几档（存的是倍数）；以前用滑杆存下的别的值照写在按钮上。 */
const SPEEDS: readonly SelectOption<string>[] = ['0.5', '0.75', '1', '1.25', '1.5', '2']
  .map((value) => ({ value, label: `${value}×` }));
const OPACITIES: readonly SelectOption<string>[] = ['0.2', '0.4', '0.6', '0.8', '1']
  .map((value) => ({ value, label: `${Math.round(Number(value) * 100)}%` }));

function optionValue(value: number, options: readonly SelectOption<string>[]): string {
  return options.find((option) => Number(option.value) === value)?.value ?? String(value);
}

/** 外观那一组里的「动态背景」一行（设计稿「设置页的布局」），开着时下面缩进几行细项。 */
export function AmbientRows(): ReactNode {
  const settings = useStore(ambientStore);
  const figure = figureById(settings.figure);
  const speed = optionValue(settings.speed, SPEEDS);
  const opacity = optionValue(settings.opacity, OPACITIES);
  return <>
    <SettingSwitch name="动态背景" tip={TIP} checked={settings.enabled}
      onChange={(enabled) => saveAmbient({ enabled })} />
    {settings.enabled ? <div className="set-sub">
      <SettingRow name="形象">
        <DropdownMenu label="形象" className="set-select" align="end" items={figureItems(settings.figure)}>
          <span>{`${GROUP_LABELS[figure.group]} · ${figure.label}`}</span><Icon name="chevron-down" size={14} />
        </DropdownMenu>
      </SettingRow>
      <SettingSelect name="速度" value={speed} options={SPEEDS}
        text={`${settings.speed.toFixed(2).replace(/\.?0+$/, '')}×`}
        onChange={(value) => saveAmbient({ speed: Number(value) })} />
      <SettingSelect name="透明度" value={opacity} options={OPACITIES} text={`${Math.round(settings.opacity * 100)}%`}
        onChange={(value) => saveAmbient({ opacity: Number(value) })} />
      <SettingRow name="显示在">
        <DropdownMenu label="显示在" className="set-select" align="end" items={pageItems(settings.pages)}>
          <span>{pagesSummary(settings.pages)}</span><Icon name="chevron-down" size={14} />
        </DropdownMenu>
      </SettingRow>
    </div> : null}
  </>;
}
