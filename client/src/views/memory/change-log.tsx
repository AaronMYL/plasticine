// 一条记忆的「用户编辑记录」、一条判断的「来路」：每次改动一行——第几版 · 谁 · 原因类别 · 时间，下面是原因；
// 设备确认过的、伴随验证程度变化的各带一个中性小签（《UI 方案》第 8 节「来路」）。

import type { ReactNode } from 'react';
import type { ChangeRecordView } from '../../api/types.ts';
import { localTime } from '../device/format.ts';
import { useTimeZone } from '../../live.tsx';
import { ACTOR_TEXT, REASON_KIND_TEXT } from './labels.ts';

export function ChangeLog(props: { title: string; records: readonly ChangeRecordView[]; now: Date }): ReactNode {
  const timeZone = useTimeZone();
  if (props.records.length === 0) {
    return <p className="block-empty">还没有改动记录。</p>;
  }
  return (
    <ol className="change-log" aria-label={props.title}>
      {props.records.map((record) => {
        const kind = record.reasonKind === null ? '' : ` · ${REASON_KIND_TEXT[record.reasonKind]}`;
        return (
          <li key={record.version} className="change-log-row">
            <span className="change-log-meta text-meta">
              第 {record.version} 版 · {ACTOR_TEXT[record.actor]}
              {record.deviceName == null ? '' : ` · ${record.deviceName}`}
              {kind} · <time className="text-meta">{localTime(record.at, timeZone)}</time>
            </span>
            {record.confirmedByDevice ? <span className="tag tag-neutral">设备确认</span> : null}
            {record.verificationChanged ? <span className="tag tag-neutral">验证程度跟着变了</span> : null}
            <span className="change-log-reason">{record.reason}</span>
          </li>
        );
      })}
    </ol>
  );
}
