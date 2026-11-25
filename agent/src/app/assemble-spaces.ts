import { KernelImages, ShrinkingIllustrator, type Illustrator, type TextModels } from '../kernel/index.ts';
import type { StateService } from '../state/index.ts';
import { SpaceRewriter } from '../subs/index.ts';
import type { KernelModelParts } from './model-providers.ts';

export function kernelImagesOf(parts: KernelModelParts | null | undefined): KernelImages | null {
  if (parts == null) {
    return null;
  }
  const kernel = parts.models;
  return new KernelImages({ models: kernel.models, codexModel: () => {
    const choice = kernel.effective('review') ?? kernel.effective();
    return choice?.provider === 'openai-codex' ? choice.model : null;
  } });
}

export function illustratorOf(parts: KernelModelParts | undefined, ffmpeg: () => string): Illustrator | null {
  const images = kernelImagesOf(parts);
  return images === null ? null : new ShrinkingIllustrator(images, ffmpeg);
}

export function spaceRewriter(state: StateService, text: TextModels, illustrator: Illustrator | null): SpaceRewriter {
  return new SpaceRewriter({ state, text, illustrator,
    saveAsset: (data, mime) => state.notes.writeAsset(data, mime).name });
}
