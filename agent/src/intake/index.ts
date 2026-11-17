// intake/：来信的两个工具（列收件箱、读一封）。11-17：这里原来还有「进门」——每来一样东西记一条触发、过粗筛、
// 命中规则就开一条后台线。四条规则 11-06 都并进了心跳、线上一直关着，记下的触发也没有别处在读，连同规则开关的
// 接口一起删了。

export { createListInboxTool } from './list-inbox-tool.ts';
export { createReadInboxTool } from './read-inbox-tool.ts';
