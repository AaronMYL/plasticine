// mates/：队友、群组和主线的身份——名单和群组任务、每位的 Soul（读写、每晚自己改、旧规则并入）、给内核的队友工具。

export { mateGroupTaskTools } from './group-task-tools.ts';
export { MateGroupTasks } from './group-tasks.ts';
export { aiNameOf, mainIdentity, setMainIdentity } from './main-identity.ts';
export { adoptMateSouls } from './mate-rules.ts';
export { Mates } from './service.ts';
export { soulNight } from './soul-night.ts';
export { soulOf, soulResponse, soulRevisionDiff, soulText, undoSoul, updateSoul } from './souls.ts';
export type { SoulState } from './souls.ts';
export { mateTools } from './tools.ts';
