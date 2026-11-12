// 设置 · AI「同时做几件事」（11-12 全量优化第 2 条）：后台同时跑几件事。自动 = 按这台机器现在忙不忙来定；
// 选了数就按选的。改了马上生效：调大了，排着队的接着开跑；调小了，在跑的做完为止。

import { useState, type ReactNode } from 'react';
import { useApi } from '../../api/context.tsx';
import { errorText } from '../../api/errors.ts';
import { WORK_LIMIT_MAX, type WorkLimitSetting, type WorkLimitView } from '../../api/shared.ts';
import { SectionHead } from './section-head.tsx';
import { Failure, useRead } from './system-read.tsx';

const NOTE = '排在后面的事会等前面的做完。等你回答的事、和队友直接说话，不占位置。';

export function WorkLimitSection(): ReactNode {
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
    <section className="block settings-ai-choice" aria-labelledby="settings-work-limit">
      <SectionHead id="settings-work-limit" title="同时做几件事" tip={NOTE} />
      {read.error !== null && current === null ? <Failure error={read.error} onReload={read.reload} /> : null}
      {current === null ? null : (
        <div className="model-choice">
          <select className="field-input" aria-labelledby="settings-work-limit" disabled={busy}
            value={String(current.setting)}
            onChange={(event) => save(event.target.value === 'auto' ? 'auto' : Number(event.target.value))}>
            <option value="auto">自动（现在 {current.effective} 件）</option>
            {Array.from({ length: WORK_LIMIT_MAX }, (_, index) => index + 1).map((count) => (
              <option key={count} value={count}>{count} 件</option>
            ))}
          </select>
        </div>
      )}
      {error === null ? null : <p className="block-empty is-error" role="alert">{error}</p>}
    </section>
  );
}
