// 「问 Plasticine」（快捷指令 / Siri，ios/ 的 App Intents）：App 打开后调 window.__plasticineAsk(text)，
// 这里把这句话展开对话发出去，和在输入框里打字发送是同一条路（主对话那条线，带 requestId、没送到可重发）。
import { useEffect, useRef } from 'react';
import { IOS_ASK_MAX_CHARS, MAIN_LINE_ALIAS } from '../api/shared.ts';
import { useLive } from '../live.tsx';
import './bridge.ts';

export function useIosAsk(openConversation: () => void): void {
  const live = useLive();
  const open = useRef(openConversation);
  open.current = openConversation;
  useEffect(() => {
    const ask = async (input: unknown): Promise<void> => {
      // 原生壳经 evaluateJavaScript 调进来，参数照外部输入先看形状。
      const text = typeof input === 'string' ? input.trim() : '';
      if (text === '' || text.length > IOS_ASK_MAX_CHARS) { return; }
      open.current();
      await live.lines.send(MAIN_LINE_ALIAS, text);
    };
    window.__plasticineAsk = ask;
    return () => {
      if (window.__plasticineAsk === ask) { delete window.__plasticineAsk; }
    };
  }, [live]);
}
