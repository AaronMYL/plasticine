// 测试连接的结果：每一步一行——勾或叹号（状态色只染符号）、一句结论、用了多久；没成的下面一行是服务端原话。
// 请求本身没发成（断网、登录过期）只有一行红字。

import type { ReactNode } from 'react';
import type { ConnectionTestStep, TestModelConnectionResponse } from '../../api/shared.ts';
import { Icon } from '../../shell/icons.tsx';

function seconds(ms: number): string {
  return ms < 1000 ? `${String(ms)} 毫秒` : `${(ms / 1000).toFixed(1)} 秒`;
}

function StepLine({ step }: { step: ConnectionTestStep }): ReactNode {
  return (
    <li className="connection-step" data-ok={step.ok}>
      <span className="connection-step-mark" role="img" aria-label={step.ok ? '成了' : '没成'}>
        <Icon name={step.ok ? 'check' : 'alert'} size={14} />
      </span>
      <span className="connection-step-main">
        <span className="connection-step-summary">{step.summary}</span>
        {step.ok || step.detail === null ? null : <span className="connection-step-detail">{step.detail}</span>}
      </span>
      <span className="connection-step-time">{seconds(step.latencyMs)}</span>
    </li>
  );
}

export function ConnectionResult({ result }: { result: TestModelConnectionResponse | string }): ReactNode {
  if (typeof result === 'string') {
    return <p className="connect-error" role="alert">没测成：{result}</p>;
  }
  return (
    <ul className="connection-result" role="status" aria-label={result.ok ? '连接正常' : '连接有问题'}>
      {result.steps.map((step) => <StepLine key={step.step} step={step} />)}
    </ul>
  );
}
