import type { ReactNode } from 'react';
import type { AskView } from '../../api/types.ts';
import { useLive } from '../../live.tsx';
import { AskCard } from '../../primitives/ask-card/index.tsx';
import { askOpKey } from '../../state/action-ops.ts';
import { useClientState } from '../../state/context.tsx';
import { useStore } from '../../state/use-store.ts';
import { useSignedOps } from '../signing/use-signed-ops.ts';
import { useOps } from '../../state/ops.ts';

export function DeviceActionCard({ ask }: { ask: AskView }): ReactNode {
  const live = useLive();
  const { inlineDrafts, signedOps, actionOps } = useClientState();
  const drafts = useStore(inlineDrafts.store);
  const key = `device-action:${ask.id}`;
  const signing = useSignedOps(key);
  const normal = useOps(`ask:${ask.id}:`);
  const answerKey = askOpKey(ask.id, 'answer');
  const askKey = askOpKey(ask.id, 'ask');
  return <AskCard ask={ask} ops={[...normal, ...signing]}
    drafts={{ answer: drafts.get(answerKey) ?? '', ask: drafts.get(askKey) ?? '' }}
    onDraft={(slot, text) => inlineDrafts.set(slot === 'answer' ? answerKey : askKey, text)}
    onOption={(optionId) => {
      if (ask.requiresSignature && optionId !== 'adopt') { void live.asks.answer(ask, { optionId }); return; }
      void live.signer.send(key, ask.requiresSignature ? '确认这项选择' : '逐次授权设备动作', ask.question,
        { kind: 'device_action_answer', askId: ask.id }, (requestId) => ({ requestId, optionId }));
    }}
    onText={(text) => void live.asks.answer(ask, { text })}
    onDefer={() => void live.asks.defer(ask)} onAskAbout={(text) => void live.asks.answer(ask, { text })}
    onRetry={(opKey) => { if (opKey === key) { void live.signer.retry(key); } }}
    onDismiss={(opKey) => { if (opKey === key) { signedOps.dismiss(key); } else { actionOps.dismiss(opKey); } }} />;
}
