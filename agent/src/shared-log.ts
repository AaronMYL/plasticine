// 日志保留明确的事件、运行位置和实际异常；调用方不把凭据对象交给日志。
import { createHash } from 'node:crypto';

const EVENTS = {
  invalid_log_event: '日志事件不在白名单内',
  // 新内核（2026-11-05 Harness 重做）：线。
  line_drive_failed: '一条线这一轮在内核里出错，线记成失败，可点重试',
  line_image_unreadable: '图片附件读不出来，这一轮只给模型附件说明',
  line_after_failed: '一条线跑完后的收尾（贴回结果、排下一条）出错，线的消息已保存',
  schedule_fire_failed: '一张定时卡到点放进定时线时出错，下次到点再试',
  timed_tick_failed: '「定时」里登记进来的一种（订阅、心跳、做梦）这一分钟看到点时出错，下一分钟再看',
  timed_ended_failed: '「定时」里登记进来的一种记上次结果时出错',
  heartbeat_failed: '心跳这一跳出错，下一跳再看',
  heartbeat_catch_up_failed: '心跳补漏发的定时出错，下一跳再看',
  heartbeat_judge_failed: '心跳叫模型判断没成，这几件下一跳再看',
  heartbeat_changed_hook_failed: '心跳改完通知界面重读时出错',
  dream_failed: '做梦这一晚没做完，下一晚把这段补上',
  self_notes_failed: '说明书这一晚没写成，下一晚再写',
  dream_changed_hook_failed: '做梦改完记忆通知界面重读时出错',
  schedule_notice_failed: '定时任务的结果要告诉他时出错，结果已记在定时列表里',
  schedule_tick_failed: '看有没有到点的定时任务时出错，一分钟后再看',
  schedule_changed_hook_failed: '定时列表变了、通知界面重读时出错',
  line_resume_failed: '重启后接着跑一条线没起来，线的状态已保存',
  line_compaction_failed: '压缩一条线的早先内容没做成，这次照原样送给模型',
  model_login_failed: '模型登录没完成，原因已回给客户端',
  line_turn_hook_failed: '一条线停下后告诉记忆整理 / 跨用户任务时出错，线本身没受影响',
  line_report_hook_failed: '后台线贴回结果时发系统通知出错，结果照常贴回',
  notice_push_failed: '主线通知已经发在主线上，系统通知（网页推送）没发出去',
  push_failed: '系统通知发送失败，卡仍在对话和清单里',
  push_rejected: '系统通知被推送服务拒收',
  ask_notify_failed: '卡的系统通知失败，记录已保存',
  project_notice_failed: '项目的逾期或停滞提醒没发到主线上，下次扫描再发；项目页照常显示',
  attention_publish_failed: '注意力变化已保存，事件推送失败',
  scan_failed: '定时扫描失败，下一轮再试',
  feed_bookmarks_mismatch: '信息流收藏和书签对不上，见启动核对',
  intake_record_failed: '进门记触发失败，原记录照旧保存',
  mac_latest_invalid: '服务器上的 Mac 包信息（latest.json）坏了，这次没给更新',
  mac_package_missing: 'latest.json 指的 Mac 包不在，这次没给更新',
  device_action_unknown: '设备动作发出后没有拿到回执，已记为结果不明',
  calendar_sync_failed: '从 Mac 同步日历和提醒出错，缓存保持原样，下一轮再试',
  direct_offer_failed: '直连握手没成，页面这次经中继',
  direct_forward_failed: '直连通道里的一个请求转给本体没成，页面这次改走中继',
  direct_response_failed: '直连通道里一个回应读到一半出错，页面这次改走中继',
  direct_send_failed: '往直连通道里发一帧没发出去',
  direct_close_failed: '关一条直连没关干净',
  calendar_sync_skipped: '从 Mac 同步日历和提醒的那一步没做成，缓存保持原样',
  mail_sync_failed: '站内信收信失败，状态已保存，下一轮再试',
  mail_sync_stopped: '收信已停止，未完成状态已保存',
  mail_parse_failed: '一封邮件的 MIME 解析不了，记成没有正文的一封，原信已存下',
  mail_refetch_broken: '重抓邮件时连接中断，剩下的记成出错，下次重跑再补',
  mail_image_failed: '邮件图片代理没取到图，回了 502',
  favicon_failed: '有个网站的图标这次没取到，标签先画首字母，过一天再试',
  legacy_bookmark_skipped: '旧存档「书签」一组里有一页加不成书签（网址收不了），跳过了，这一页也不再成标签',
  mail_inline_missing: '邮件内嵌图的文件读不到，这张图不显示',
  notification_mail_failed: '通知信未完成，请核对发送回执',
  external_feed_failed: '本次外部信息流未完成，可稍后刷新',
  feed_source_failed: '一个搜索词或订阅抓取失败，继续其他来源',
  feed_translate_failed: '一条信息流没翻成中文，原因记下了，下次扫描再试',
  video_parse_failed: '一条视频没解析成，原因记在那一条上，可在抖音收藏里再处理',
  video_skill_seed_failed: '视频解析技能没装进数据目录，下次启动再装',
  sample_card_backfill_failed: '样刊的「开启定时」卡没补上，下次启动再补',
  space_rewrite_failed: '一个旧空间按新版式重写没成，留着旧版，下次启动再试',
  feed_subscription_failed: '一个订阅这次没抓到，原因记在设置那一行，两小时后再试',
  sse_failed: '事件推送失败，已关闭对应连接',
  after_commit_failed: '请求已提交，后续动作失败',
  request_failed: '请求处理失败',
  library_batch_item_failed: '批量处理中的一项没有完成，结果保留供重试',
  error_response_failed: '错误响应未发出，连接已断开',
  memory_curation_failed: '记忆整理这一次没做成，原因已记在整理作业里，稍后重试',
  memory_conflicts_failed: '夜里找说法冲突这一次没做成，下一晚再找',
  dream_suggest_failed: '做梦时想到的一件没了结的事没能放进建议，这一晚的记忆整理不受影响',
  translate_output_invalid: '网页翻译：模型回的不是约定的 JSON，这一批记为没译成',
  payment_attachment_purge_failed: '已确认截图的原件清理未完成，将在下一次扫描重试',
  backup_prune_failed: '本机备份保留期清理未完成，请核对权限和登记目录',
  backup_failed: '本机备份这次没写成，记成失败，下一个小时再看',
  client_release_invalid: '客户端发布清单或回执校验不过，版本更新那一节显示出错',
  payment_read_failed: '付款截图没识别出来，草案留给你手填',
  restore_review_required: '这是待核对的离线恢复目录，先核对较新数据和删除记录，再按恢复文档人工切换',
  startup_invalid: '启动配置无效，请检查 PLASTICINE_STATE、PORT 与 VAPID_SUBJECT',
  login_required: '还没有连接模型：登录 Plasticine（桌面客户端直接进，别的设备用 @账号和密码）后在「设置 · AI」里登录或填 key',
  service_started: '服务开始监听',
  maintenance_socket_opened: '维护入口开始在本机 socket 上监听',
  maintenance_socket_failed: '维护入口没有开起来，服务照常运行',
  maintenance_request_failed: '维护命令出了意外，结果待核实',
  service_stopping: '收到停止信号，线停下、重启后接着跑',
  startup_failed: '服务启动或停止失败，请检查配置和状态目录',
  state_directory_required: '需要设置 PLASTICINE_STATE 后再运行',
  pairing_created: '配对码已生成，仅在交互终端显示',
  pairing_failed: '配对码生成失败，请在服务器交互终端重试',
  password_reset_failed: '主人密码没改成，请核对 PLASTICINE_STATE 和权限后重试',
  setup_link_failed: '建账号链接没生成出来，请核对 PLASTICINE_STATE 和权限后重试',
  terminal_required: '此操作需要交互终端，不能把授权代码写入日志或重定向输出',
  feed_url_rejected: '旧条目链接格式不支持，暂不展示链接，请重新添加有效网址',
  // 第 113 条：联系人与 Cyber Hunter 网络（network/）。
  account_network_join_failed: '建账号时 @账号没在网络里注册成，账号照建，回执里写了原因',
  network_handle_check_failed: '问中继 @账号能不能用没问成，界面照常让填，注册时中继再说',
  network_send_failed: '一封要发给联系人的信这次没交给中继，稍后按退避重试',
  network_task_status_failed: '信已经交给中继，任务状态记录这次没记上；两端本地各有一份',
  network_sync_failed: '和 Cyber Hunter 中继同步这次没成，稍后自动再试',
  network_envelope_rejected: '收到一封验签或解密不过的信，已丢掉并在聊天里记了一条',
  network_envelope_failed: '处理一封收到的信时出错，这封已丢掉并记了一条',
  network_responder_failed: '替主人答话这次没做完，问题留在聊天里等主人看',
  network_responder_unparsed: '替主人答话的线最后那段不是要的 JSON，当成拿不准的草稿交给主人',
  network_delivery_failed: '本机的线做完了，交付这次没发出去，下次同步时再试',
  // 2026-11-05：中继独立成服务（network-relay/main.ts）和实例的隧道（network/tunnel*.ts）。
  relay_started: 'Cyber Hunter 中继开始监听（前门 443 / 80、本机口）',
  relay_stopping: 'Cyber Hunter 中继收到停止信号，正在关',
  relay_startup_invalid: '中继的启动配置无效，请检查 CYBERHUNTER_STATE 和端口',
  relay_startup_failed: '中继启动或停止失败，请检查端口占用和状态目录',
  relay_request_failed: '中继处理一个 /v2/net 请求时出了意外，回了 500',
  relay_connection_failed: '前门处理一条连接时出了意外，这条连接已关',
  relay_certificate_renewed: '中继主域名的证书签下来了（或续上了）',
  relay_certificate_failed: '中继主域名的证书这次没签下来，先用原来的，过一会儿再试',
  tunnel_certificate_renewed: '这台实例的隧道域名证书签下来了（或续上了）',
  tunnel_certificate_failed: '这台实例的隧道域名证书这次没签下来，过一会儿再试',
} as const;

export type LogEvent = keyof typeof EVENTS;
const ERROR_CATEGORIES = [
  'Error', 'TypeError', 'SyntaxError', 'RangeError', 'ReferenceError', 'URIError', 'AggregateError',
  'AbortError', 'TimeoutError', 'StateError', 'AttentionError', 'TextModelError', 'LineError',
  'DailyError', 'ApiError', 'ShapeError', 'UnknownError', 'TransportError', 'DeviceError',
  'CloudToolError', 'LifeError', 'ArtifactError', 'MailImageError', 'FaviconFetchError', 'PostalMimeError',
  'auth', 'quota', 'rate_limit', 'overloaded', 'server', 'timeout', 'network', 'context_overflow',
  'format', 'aborted', 'unknown',
] as const;
export type ErrorCategory = (typeof ERROR_CATEGORIES)[number];
const TABLES = [
  'topics', 'records', 'library', 'settings', 'feed', 'brief', 'interview', 'hunters',
  'judgments', 'cards', 'terms', 'observations', 'extractions', 'maintenance', 'guide', 'notes',
  'assets', 'revisions', 'changes', 'money', 'focus', 'inbox', 'notify', 'telemetry', 'materials',
] as const;
export type LogTable = (typeof TABLES)[number];
const COUNTERS = [
  'count', 'created', 'skipped', 'old', 'matched', 'problems', 'notices', 'skippedByChoice', 'deleted',
  'copied', 'present', 'missing', 'referenced', 'port', 'interrupted', 'taskRunsInterrupted', 'claimsReleased',
  'receiptsUnknown', 'cardsRaised', 'events', 'characters', 'tools', 'input', 'cacheRead', 'output', 'reasoning',
  'passed', 'total', 'categories', 'accounts',
] as const;
type Counter = (typeof COUNTERS)[number];

export interface LogFields {
  category?: ErrorCategory;
  error?: unknown;
  stepKey?: string;
  logPath?: string;
  /** 只输出稳定散列，调用方意外传入外部 id 时也不会把其中的文本带入日志。 */
  objectId?: string;
  table?: LogTable;
  status?: number;
  counts?: Partial<Record<Counter, number | null>>;
}

export function logCategory(value: unknown): ErrorCategory {
  return ERROR_CATEGORIES.includes(value as ErrorCategory) ? value as ErrorCategory : 'UnknownError';
}

export function errorCategory(error: unknown): ErrorCategory {
  if (!(error instanceof Error)) {
    return 'UnknownError';
  }
  // name 也可能被改成 getter；只读数据描述符，避免错误分类本身再次抛出携带原文的异常。
  let prototype: object | null = error;
  while (prototype !== null) {
    const name = Object.getOwnPropertyDescriptor(prototype, 'name');
    if (name !== undefined) {
      return logCategory(name.value);
    }
    prototype = Object.getPrototypeOf(prototype);
  }
  return 'UnknownError';
}

// 不遍历调用方对象，不执行 getter / toJSON，也不展开额外字段。
function ownValue(object: object, key: string): unknown {
  return Object.getOwnPropertyDescriptor(object, key)?.value;
}

export function safeLog(level: 'log' | 'warn' | 'error', event: LogEvent, fields: LogFields = {}): void {
  const known = typeof event === 'string' && Object.hasOwn(EVENTS, event) ? event : 'invalid_log_event';
  const entry: Record<string, unknown> = { event: known, text: EVENTS[known] };
  if (typeof fields === 'object' && fields !== null) {
    const category = ownValue(fields, 'category');
    if (category !== undefined) {
      entry['category'] = logCategory(category);
    }
    const error = ownValue(fields, 'error');
    if (error !== undefined) { entry['errorMessage'] = failureText(error); }
    if (error instanceof Error) { entry['errorStack'] = error.stack; }
    for (const key of ['stepKey', 'logPath']) {
      const value = ownValue(fields, key);
      if (typeof value === 'string') { entry[key] = value; }
    }
    const id = ownValue(fields, 'objectId');
    if (typeof id === 'string') {
      entry['objectIdHash'] = createHash('sha256').update(id).digest('hex');
    }
    const table = ownValue(fields, 'table');
    if (TABLES.includes(table as LogTable)) {
      entry['table'] = table;
    }
    const status = ownValue(fields, 'status');
    if (typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599) {
      entry['status'] = status;
    }
    const counts = ownValue(fields, 'counts');
    if (typeof counts === 'object' && counts !== null) {
      for (const key of COUNTERS) {
        const value = ownValue(counts, key);
        if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
          entry[key] = value;
        }
      }
    }
  }
  const method = level === 'log' || level === 'warn' ? level : 'error';
  console[method](JSON.stringify(entry));
}

/** 错误类别用于分类，原始原因用于修复；两者都留下，摘要由读取界面裁剪。 */
export function failureText(error: unknown): string {
  if (error instanceof Error) {
    const message = error.message || error.name;
    return error.cause === undefined ? message : `${message}\n原因：${failureText(error.cause)}`;
  }
  return typeof error === 'string' ? error : '执行失败，异常没有提供可读原因。';
}
