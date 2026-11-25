import { useState, type ReactNode } from 'react';
import { useApi } from '../../api/context.tsx';
import { errorText } from '../../api/errors.ts';
import { WORK_LIMIT_MAX, type WorkLimitSetting, type WorkLimitView } from '../../api/shared.ts';
import { InfoTip } from '../../shell/info-tip.tsx';
import { SelectButton } from './setting-row.tsx';
import { Failure, useRead } from './system-read.tsx';

const NOTE = '排在后面的事会等前面的做完。等你回答的事、和队友直接说话，不占位置。';

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
          <SelectButton label="同时做几件事" value={String(current.setting)} disabled={busy}
            options={[{ value: 'auto', label: `自动（现在 ${current.effective} 件）` },
              ...Array.from({ length: WORK_LIMIT_MAX }, (_, index) => ({ value: String(index + 1),
                label: `${index + 1} 件` }))]}
            onChange={(value) => save(value === 'auto' ? 'auto' : Number(value))} />
        )}
      </div>
      {read.error !== null && current === null ? <Failure error={read.error} onReload={read.reload} /> : null}
      {error === null ? null : <p className="ai-use-issue" role="alert">{error}</p>}
    </div>
  );
}
