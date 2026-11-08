// 约定的上下文与版本来路（就地展开）。开关在这一条的行尾 ⋯ 里（2026-11-04 第 2 批：次要操作收进行尾 ⋯），这里只管
// 开着时读详情、读失败给「重试」。

import { useEffect, useState, type ReactNode } from 'react';
import { useApi } from '../../api/context.tsx';
import { errorText } from '../../api/errors.ts';
import type { AgreementDetail } from '../../api/types.ts';
import { ChangeLog } from './change-log.tsx';
import { SourceContextView } from './source-context.tsx';

export function AgreementHistory({ id, version }: { id: string; version: number }): ReactNode {
  const api = useApi();
  const [detail, setDetail] = useState<AgreementDetail | null>(null);
  const [error, setError] = useState('');
  const read = async (): Promise<void> => {
    setError('');
    try { setDetail(await api.agreements.get(id)); } catch (cause) { setError(errorText(cause)); }
  };
  useEffect(() => { void read(); }, [id, version]);
  return error ? <p role="alert">{error} <button className="text-button" type="button"
    onClick={() => void read()}>重试</button></p> : detail === null ? <p>正在读来路…</p> : <>
    <SourceContextView source={detail.sourceContext} />
    <ChangeLog title="约定版本来路" records={detail.history} now={new Date()} />
  </>;
}
