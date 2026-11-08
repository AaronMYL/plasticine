// network/：每个 Plasticine 实例在 Cyber Hunter 网络上的那一头（第 113 条，docs/specs/contacts-network.md）。身份钥匙、
// 加密与签名、和中继的同步循环、联系人与消息、分身、跨用户任务；还有 <handle>.cyberhunter.top 的隧道客户端和它的证书
// （tunnel*.ts、certificates.ts、acme.ts）。它不直接调模型：替主人答话开新内核的线（responder.ts，app/ 注入开线），
// 不碰数据库句柄（只用 state/ 的 stores）。

export { generateIdentityKeys, newNonce, openEnvelope, PROTOCOL_INFO, requestSigningText, safetyCode, sealEnvelope,
  sha256Hex, signEnvelope, signText, verifyEnvelope, verifyText } from './crypto.ts';
export type { IdentityKeys, KeyPair, OpenedEnvelope, SafetyParty, SealInput } from './crypto.ts';
export { checkRelayUrl, DEFAULT_RELAY_URL, effectiveRelayUrl, LEGACY_RELAY_URLS, RelayCallError, RelayClient,
  signedHeaders } from './relay-client.ts';
export type { RelayClientOptions, RelayFailure, Signer } from './relay-client.ts';
export { NetworkError, NETWORK_ERROR_CODES } from './errors.ts';
export type { NetworkErrorCode } from './errors.ts';
export type { NetworkChange } from './context.ts';
export { DEFAULT_POLL_WAIT_SECONDS, isLoopback, NetworkService } from './service.ts';
export type { JoinInput, NetworkServiceOptions } from './service.ts';
export { OUTBOX_MAX_ATTEMPTS, OUTBOX_RETRY_BASE_MS, retryDelayMs } from './outbox.ts';
export { HOLDING_LINE, MAX_AI_ROUNDS, parseAnswer, RESPONDER_CONTEXT_LINES } from './responder.ts';
export { groupReach } from './groups.ts';
export type { CreateGroupInput, UpdateGroupInput } from './groups.ts';
export type { GroupTaskInput } from './group-tasks.ts';
export { checkAvatar } from './profile.ts';
export { taskStage, taskWaiting } from './tasks.ts';
export type { TaskDecision, TaskVerdict } from './tasks.ts';
export { gatherMaterials, listMaterials, reachOf, suggestTier } from './visibility.ts';
export type { MaterialEntry } from './visibility.ts';
export { createAcmeIssuer, LETS_ENCRYPT_DIRECTORY } from './acme.ts';
export type { AcmeAutoOptions, AcmeClientLike, AcmeIssuerOptions } from './acme.ts';
export { CertificateKeeper, ChallengeResponses, renewAt, writePrivateFile } from './certificates.ts';
export type { CertificateIssuer, CertificateKeeperOptions } from './certificates.ts';
export { selfSignedCertificate } from './self-signed.ts';
export type { CertificatePair } from './self-signed.ts';
export { ACME_CHALLENGE_PREFIX, challengeToken, plainResponse, readRequestHead } from './http-head.ts';
export type { RequestHead } from './http-head.ts';
export { backoffDelay, TunnelClient } from './tunnel-client.ts';
export type { TunnelClientOptions, TunnelState, TunnelStatus } from './tunnel-client.ts';
export { terminate } from './tunnel-terminator.ts';
export type { TerminatorOptions } from './tunnel-terminator.ts';
export { TUNNEL_DIRECTORY, TunnelService } from './tunnel.ts';
export type { TunnelServiceOptions } from './tunnel.ts';
