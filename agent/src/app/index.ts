// app/: the HTTP service. Resources are one file each, the routes one table (router.ts); request and response
// shapes come from shared/api. Started by main.ts; the owner logs in with a password (password-cli.ts resets it,
// setup-link-cli.ts prints the one-time setup link); pairing-cli.ts still makes the old pairing codes.

export { createApp } from './app.ts';
export type { App, AppOptions } from './app.ts';
export { assembleApp } from './assemble.ts';
export type { AssembleOptions } from './assemble.ts';
export { DEFAULT_PORT, HOST, SESSION_COOKIE } from './config.ts';
export { EventHub } from './event-hub.ts';
export { issuePairingCode, normalizePairingCode } from './pairing-code.ts';
export { ROUTES } from './router.ts';
