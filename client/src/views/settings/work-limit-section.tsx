// 设置 · AI「同时做几件事」（11-12 全量优化第 2 条；第13批起是「对话」分组里的一行）：后台同时跑几件事。自动 = 按这台机器现在忙不忙来定；
// 选了数就按选的。改了马上生效：调大了，排着队的接着开跑；调小了，在跑的做完为止。

import { useState, type ReactNode } from 'react';
import { useApi } from '../../api/context.tsx';
import { errorText } from '../../api/errors.ts';
import { WORK_LIMIT_MAX, type WorkLimitSetting, type WorkLimitView } from '../../api/shared.ts';
import { InfoTip } from '../../shell/info-tip.tsx';
import { Failure, useRead } from './system-read.tsx';

const NOTE = '排在后面的事会等前面的做完。等你回答的事、和队友直接说话，不占位置。';

/**
 * 第13批设置 · AI 分组后：「对话」里的一行（名字 + ⓘ，右边一个下拉）。读、存和上面那段一样，只是排成一行。
 */
export function WorkLimitRow(): ReactNode {
  const api = useApi();
  const read = useRead<WorkLimitView>((signal) => api.account.workLimit(signal), [api]);
  const [saved, setSaved] = useState<WorkLimitView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = saved ?? read.value;
  const save = (setting: WorkLimitSetting): void => {
    setBusy(true);
    setError(null);
    api.account.setWorkLimit(setting).then(setSaved, (cause: unknown) => setError(errorText(cause)))
      .finally(() => setBusy(false));
  };
  return (
    <div className="ai-use">
      <div className="ai-use-line">
        <span className="ai-use-name"><span id="settings-work-limit">同时做几件事</span>
          <InfoTip label="同时做几件事的说明" text={NOTE} /></span>
        {current === null ? null : (
          <select className="field-input ai-use-select" aria-labelledby="settings-work-limit" disabled={busy}
            value={String(current.setting)}
            onChange={(event) => save(event.target.value === 'auto' ? 'auto' : Number(event.target.value))}>
            <option value="auto">自动（现在 {current.effective} 件）</option>
            {Array.from({ length: WORK_LIMIT_MAX }, (_, index) => index + 1).map((count) => (
              <option key={count} value={count}>{count} 件</option>
            ))}
          </select>
        )}
      </div>
      {read.error !== null && current === null ? <Failure error={read.error} onReload={read.reload} /> : null}
      {error === null ? null : <p className="ai-use-issue" role="alert">{error}</p>}
    </div>
  );
}
