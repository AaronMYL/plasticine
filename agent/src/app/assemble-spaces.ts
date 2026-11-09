// 第 8 批第 6 条（空间改成整页网页）在组装时的两件：出图（来信的插图，走他连着的 OpenAI）和旧空间按新版式重写
// （服务起来后的一次性后台活，登记成扫描）。

import { KernelImages, type Illustrator, type TextModels } from '../kernel/index.ts';
import type { StateService } from '../state/index.ts';
import { SpaceRewriter } from '../subs/index.ts';
import type { KernelModelParts } from './model-providers.ts';

/** 出图走他连着的 OpenAI；订阅那一路的路由模型用回顾在用的（是订阅的话），不然目录里第一个。 */
export function illustratorOf(parts: KernelModelParts | undefined): Illustrator | null {
  if (parts === undefined) {
    return null;
  }
  const kernel = parts.models;
  return new KernelImages({ models: kernel.models, codexModel: () => {
    const choice = kernel.effective('review') ?? kernel.effective();
    return choice?.provider === 'openai-codex' ? choice.model : null;
  } });
}

/** 旧空间重写：插图存进 Plasticine 自己的资产（和笔记里的图同一处）。 */
export function spaceRewriter(state: StateService, text: TextModels, illustrator: Illustrator | null): SpaceRewriter {
  return new SpaceRewriter({ state, text, illustrator,
    saveAsset: (data, mime) => state.notes.writeAsset(data, mime).name });
}
