// util/：谁都能用的小工具——日志（源码里唯一能碰 console 的地方）、文字、终端输出、校验、链接清洗。不含业务，不引业务模块。

export { cleanOutboundText, cleanUrlQuery, isCredentialParam } from './link-clean.ts';
export { EXTERNAL_LINK, splitLink } from './link-text.ts';
export { errorCategory, failureText, safeLog } from './log.ts';
export type { LogEvent } from './log.ts';
export { requireInteractiveTerminal, showAuthorization } from './terminal.ts';
export { clip } from './text.ts';
export { validationField } from './validation.ts';
