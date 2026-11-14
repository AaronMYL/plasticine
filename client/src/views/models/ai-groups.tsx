// 设置 · AI 按用在哪儿分组（第13批，11-14 Aaron：「有点乱，该归类该放一起的就放一起」，看过设计稿 PredictSettings 弹框选
// 「照设计稿做」）：模型 · 对话 · 例行 · 笔记、阅读和资料 · 记忆和记账 · 工具和技能。一个功能的开关、选项和用哪个模型在同一行
// （输入建议的开关和模型在一起），「同时做几件事」在对话里，出图有自己一行。

import type { ReactNode } from 'react';
import type { ListModelProvidersResponse, ModelPurpose } from '../../api/shared.ts';
import { useLive } from '../../live.tsx';
import { routeHash, skillsRoute } from '../../shell/routes.ts';
import { useStore } from '../../state/use-store.ts';
import { ComposePredictSwitch } from '../settings/compose-predict-section.tsx';
import { WorkLimitRow } from '../settings/work-limit-section.tsx';
import { TOOL_GROUPS_NOTE, ToolGroupsView } from '../tools/tool-groups-view.tsx';
import { InfoTip } from '../../shell/info-tip.tsx';
import { connectRequest } from './ai-providers.tsx';
import { FoldedRows, MergedRow, PurposeRow } from './ai-purposes.tsx';

const NOTES: readonly ModelPurpose[] = ['note_predict', 'note_interject', 'note_polish', 'note_organize',
  'note_correct', 'note_format', 'note_chart', 'note_custom'];
const CODEX = 'openai-codex';

function Group({ id, title, children }: { id: string; title: string; children: ReactNode }): ReactNode {
  return (
    <section className="ai-group" aria-labelledby={id}>
      <h3 id={id} className="ai-group-title">{title}</h3>
      <div className="ai-list">{children}</div>
    </section>
  );
}

/** 出图用哪个登录：连着 ChatGPT（Codex）就用它，不然用 OpenAI 的 API key；都没有给一个去连的按钮。 */
function ImageRow({ value }: { value: ListModelProvidersResponse }): ReactNode {
  const codex = value.providers.find((item) => item.id === CODEX);
  const openai = value.providers.find((item) => item.id === 'openai');
  const source = codex?.connected != null ? 'ChatGPT（Codex）'
    : openai?.connected === 'api_key' ? 'OpenAI · API key' : null;
  return (
    <div className="ai-use">
      <div className="ai-use-line">
        <span className="ai-use-name">出图<span className="ai-use-sub">来信配图</span></span>
        {source !== null ? <span className="ai-use-static">{source}</span> : codex === undefined ? (
          <span className="ai-use-static" data-quiet="true">没有能出图的登录</span>
        ) : (
          <button type="button" className="secondary-button button-small" onClick={() => connectRequest.set(CODEX)}>
            连接 ChatGPT（Codex）
          </button>
        )}
      </div>
    </div>
  );
}

export function AiGroups(): ReactNode {
  const live = useLive();
  const value = useStore(live.models.store).value;
  return (
    <div className="ai-groups">
      {value === null ? null : <>
        <Group id="ai-group-chat" title="对话">
          <PurposeRow value={value} purpose="main" label="主线" />
          <PurposeRow value={value} purpose="side" label="队友" sub="没在编辑队友里单独选的" />
          <PurposeRow value={value} purpose="agent" label="后台线（子代理）" />
          <WorkLimitRow />
          <PurposeRow value={value} purpose="network_reply" label="联系人和群代答" />
          <PurposeRow value={value} purpose="compose_predict" label="输入建议" sub="输入框里猜你要发的那句">
            <ComposePredictSwitch />
          </PurposeRow>
          <PurposeRow value={value} purpose="compaction" label="对话压缩" />
        </Group>
        <Group id="ai-group-routine" title="例行">
          <PurposeRow value={value} purpose="heartbeat" label="心跳" />
          <PurposeRow value={value} purpose="dream" label="做梦" sub="每晚整理记忆" />
          <PurposeRow value={value} purpose="review" label="回顾" sub="日报、周报" />
          <PurposeRow value={value} purpose="researcher" label="研究员" sub="订阅周报" />
        </Group>
        <Group id="ai-group-read" title="笔记、阅读和资料">
          <FoldedRows value={value} purposes={NOTES} label="笔记" sub={`续写、补充建议等 ${NOTES.length} 项`} />
          <PurposeRow value={value} purpose="translation" label="翻译" />
          <MergedRow value={value} purposes={['feed_selection', 'feed_comment']} label="信息流"
            sub="选材、摘要、回复评论" />
          <MergedRow value={value} purposes={['book_digest', 'book_outline', 'book_key_points']} label="图书"
            sub="章节归纳、大纲、重点" />
          <MergedRow value={value} purposes={['web_extract', 'video_digest']} label="网页提取和视频解析" />
          <ImageRow value={value} />
        </Group>
        <Group id="ai-group-memory" title="记忆和记账">
          <MergedRow value={value} purposes={['memory_curate', 'memory_compact']} label="记忆整理"
            sub="对话里记、合并压缩" />
          <PurposeRow value={value} purpose="payment_read" label="付款截图识别" sub="要能看图的模型" />
        </Group>
      </>}
      <section className="ai-group" aria-labelledby="ai-group-tools">
        <div className="ai-group-head">
          <h3 id="ai-group-tools" className="ai-group-title">工具和技能</h3>
          <InfoTip label="工具和技能的说明" text={TOOL_GROUPS_NOTE} />
        </div>
        <div className="ai-list">
          <div className="ai-use">
            <div className="ai-use-line">
              <span className="ai-use-name">技能</span>
              <a className="text-button" href={routeHash(skillsRoute())}>打开技能页</a>
            </div>
          </div>
          <ToolGroupsView note={false} />
        </div>
      </section>
    </div>
  );
}
