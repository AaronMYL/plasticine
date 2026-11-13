// 装之前先看：这个技能叫什么、什么时候用、让 Plasticine 怎么做；带脚本的把后果写出来；点了才装。

import { useState, type ReactNode } from 'react';
import { useApi } from '../../api/context.tsx';
import { errorText } from '../../api/errors.ts';
import { createRequestId } from '../../api/request-id.ts';
import type { SkillOrigin, SkillPreview, SkillRow } from '../../api/shared.ts';
import { Markdown } from '../../primitives/message/markdown.tsx';
import { methodText, skillLabel } from './skill-text.ts';

export interface SkillPreviewPaneProps {
  from: SkillOrigin;
  preview: SkillPreview;
  /** 商店里的写「官方」「社区」；网址、文件来的没有。 */
  badge?: string | undefined;
  updatedAt?: string | undefined;
  onInstalled: (skill: SkillRow) => void;
  /** 装好以后「去看看」；不给就不出这个链接（装完直接跳走的那两种）。 */
  onOpen?: ((name: string) => void) | undefined;
}

export function SkillPreviewPane({ from, preview, badge, updatedAt, onInstalled, onOpen }: SkillPreviewPaneProps)
  : ReactNode {
  const api = useApi();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(preview.installed);
  const [error, setError] = useState<string | null>(null);
  const label = skillLabel(preview);
  const install = (replace: boolean): void => {
    setBusy(true);
    setError(null);
    api.skills.install({ requestId: createRequestId(), from, ...(replace ? { replace: true } : {}) }).then((result) => {
      setBusy(false);
      setDone(true);
      onInstalled(result.skill);
    }, (cause: unknown) => {
      setBusy(false);
      setError(errorText(cause));
    });
  };
  return <aside className="skill-preview" aria-label={`「${label}」的内容`}>
    <header className="skill-detail-head">
      <h2>{label}</h2>
      {badge === undefined ? null : <span className="tag tag-neutral">{badge}</span>}
    </header>
    {label === preview.name ? null : <p className="skill-detail-name">{preview.name}</p>}
    <p className="skill-detail-desc">{preview.description}</p>
    <p className="skill-detail-meta">
      <span>{preview.scripts ? '带脚本' : '只有方法，不带脚本'}</span>
      {preview.files.length < 2 ? null : <span>{preview.files.length} 个文件</span>}
      {updatedAt === undefined ? null : <span>{updatedAt.slice(5)} 更新</span>}
    </p>
    {preview.scripts ? <p className="skill-preview-warn" role="note">
      带脚本：Plasticine 用到这个技能时，会在这台机器上运行里面的脚本。来源信得过再装。</p> : null}
    <h3>装上以后 Plasticine 会这样做</h3>
    <div className="skill-method skill-preview-method"><Markdown text={methodText(preview.text)} /></div>
    {error === null ? null : <p className="skills-error" role="alert">{error}</p>}
    <div className="skill-preview-actions">
      {done ? <>
        <button type="button" className="primary-button" disabled>已装</button>
        {onOpen === undefined ? null : <button type="button" className="secondary-button"
          onClick={() => onOpen(preview.name)}>去看看</button>}
        <button type="button" className="text-button text-button-quiet" disabled={busy}
          onClick={() => install(true)}>{busy ? '正在装…' : '重新安装'}</button>
      </> : <button type="button" className="primary-button" disabled={busy} onClick={() => install(false)}>
        {busy ? '正在装…' : '安装'}</button>}
    </div>
  </aside>;
}
