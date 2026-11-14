// kernel/：新内核的模型与凭证。pi-ai 的 Models 装上内置的全部提供商（一律平级），凭证存在 plasticine.sqlite，
// 订阅登录直接跑 pi-ai 提供商自己的流程。线（lines/）从这里拿模型；app/ 从这里挂连接模型的接口。

export { SqliteCredentialStore } from './credentials.ts';
export { DEFAULT_THINKING, KernelModelError, KernelModels } from './models.ts';
export type { KernelModelsOptions, KernelModelState } from './models.ts';
export { LOGIN_START_WAIT_MS, LOGIN_TTL_MS, ProviderLogins } from './logins.ts';
export { ILLUSTRATION_TIMEOUT_MS, KernelImages } from './images.ts';
export { SHRINK_MAX_WIDTH, ShrinkingIllustrator, shrinkIllustration } from './image-shrink.ts';
export type { Illustration, IllustrationMime, Illustrator, KernelImagesOptions } from './images.ts';
export { TranslateModel } from './translate-model.ts';
export { kernelText, NO_MODEL_TEXT, TextModelError, thinkingOf } from './text.ts';
export type { TextAnswer, TextDeltas, TextImage, TextMessage, TextModelErrorKind, TextModels, TextRequest }
  from './text.ts';
