import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { deviceTimeZone } from '../../state/time-zone.ts';
import { isTimeZone } from '../../../../agent/shared/time-zone.ts';

const KNOWN_ZONES: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'Asia/Shanghai', label: '北京时间 · 北京 / 上海 / 广州' },
  { id: 'Asia/Singapore', label: '新加坡' },
  { id: 'Asia/Hong_Kong', label: '香港' },
  { id: 'Asia/Taipei', label: '台北' },
  { id: 'Asia/Tokyo', label: '日本 · 东京' },
  { id: 'Asia/Seoul', label: '韩国 · 首尔' },
  { id: 'Asia/Bangkok', label: '泰国 · 曼谷 / 清迈' },
  { id: 'Asia/Kuala_Lumpur', label: '马来西亚 · 吉隆坡' },
  { id: 'Asia/Dubai', label: '阿联酋 · 迪拜' },
  { id: 'Asia/Kolkata', label: '印度 · 新德里 / 加尔各答' },
  { id: 'Australia/Sydney', label: '澳大利亚 · 悉尼' },
  { id: 'Australia/Melbourne', label: '澳大利亚 · 墨尔本' },
  { id: 'Australia/Perth', label: '澳大利亚 · 珀斯' },
  { id: 'Australia/Brisbane', label: '澳大利亚 · 布里斯班' },
  { id: 'Pacific/Auckland', label: '新西兰 · 奥克兰' },
  { id: 'America/Los_Angeles', label: '美国 · 洛杉矶 / 旧金山' },
  { id: 'America/New_York', label: '美国 · 纽约' },
  { id: 'America/Chicago', label: '美国 · 芝加哥' },
  { id: 'Pacific/Honolulu', label: '美国 · 夏威夷 / 火奴鲁鲁' },
  { id: 'America/Vancouver', label: '加拿大 · 温哥华' },
  { id: 'America/Toronto', label: '加拿大 · 多伦多' },
  { id: 'Europe/London', label: '英国 · 伦敦' },
  { id: 'Europe/Paris', label: '法国 · 巴黎' },
  { id: 'Europe/Berlin', label: '德国 · 柏林' },
  { id: 'Europe/Lisbon', label: '葡萄牙 · 里斯本' },
  { id: 'Etc/UTC', label: '协调世界时 · UTC' },
];

function zoneChoices() {
  const known = new Map(KNOWN_ZONES.map((zone) => [zone.id, zone.label]));
  const available = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
  return [...KNOWN_ZONES, ...available.filter((id) => !known.has(id))
    .map((id) => ({ id, label: id.split('/').at(-1)?.replaceAll('_', ' ') ?? id }))];
}

function localPreview(zone: string, now: Date): string {
  if (!isTimeZone(zone)) { return '选择有效时区后，可在这里核对当前时间。'; }
  const clock = new Intl.DateTimeFormat('zh-CN', { timeZone: zone, year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(now);
  const name = new Intl.DateTimeFormat('en', { timeZone: zone, timeZoneName: 'longOffset' })
    .formatToParts(now).find((part) => part.type === 'timeZoneName')?.value ?? 'GMT';
  const offset = name === 'GMT' ? 'UTC+00:00' : name.replace('GMT', 'UTC');
  return `${clock} · ${offset}`;
}

export function TimeZoneField({ value, disabled, onChange }: {
  value: string; disabled: boolean; onChange: (value: string) => void;
}): ReactNode {
  const id = useId();
  const [query, setQuery] = useState('');
  const [now, setNow] = useState(() => new Date());
  const choices = useMemo(zoneChoices, []);
  const device = deviceTimeZone();
  const following = value === '';
  const zone = following ? device : value;
  const label = choices.find((entry) => entry.id === zone)?.label ?? zone;
  const term = query.trim().toLocaleLowerCase();
  const results = choices.filter((entry) => `${entry.id} ${entry.label}`.toLocaleLowerCase().includes(term));
  const shown = results.slice(0, term === '' ? 8 : 16);
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return <section className="settings-time-zone" aria-label="时区">
    <h3 className="block-title">时区</h3>
    <div className="segmented" role="group" aria-label="时区选择方式">
      <button type="button" className="segmented-item" aria-pressed={following} disabled={disabled}
        onClick={() => onChange('')}>跟随设备</button>
      <button type="button" className="segmented-item" aria-pressed={!following} disabled={disabled}
        onClick={() => onChange(following ? device : value)}>选择时区</button>
    </div>
    <output className="time-zone-now" aria-label="所选时区的当前时间">
      <span>{label}</span><span className="text-meta">{localPreview(zone, now)}</span>
    </output>
    {following ? null : <>
      <label className="field"><span className="field-label">搜索城市或时区</span>
        <input type="search" className="search-input" value={query} disabled={disabled}
          placeholder="例如北京、新加坡、London" onChange={(event) => setQuery(event.target.value)} />
      </label>
      <ul className="time-zone-results" aria-label="可选时区">
        {shown.map((entry) => <li key={entry.id}><button type="button" className="chip-button time-zone-result"
          aria-pressed={entry.id === value} disabled={disabled} onClick={() => onChange(entry.id)}>
          <span>{entry.label}</span><span className="text-meta">{entry.id}</span>
        </button></li>)}
      </ul>
      {shown.length === 0 ? <p className="block-empty">没有找到</p> : null}
      <details><summary>直接填写时区名称</summary>
        <label className="field" htmlFor={`${id}-value`}><span className="field-label">时区名称</span>
          <input id={`${id}-value`} className="field-input field-input-mono" value={value} readOnly={disabled}
            placeholder="Asia/Shanghai" onChange={(event) => onChange(event.target.value)} />
        </label>
      </details>
    </>}
  </section>;
}
