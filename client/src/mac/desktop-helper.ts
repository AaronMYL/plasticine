import type { HelperMethod, HelperParams, HelperResult } from '../../../agent/shared/desktop-helper-protocol.ts';
import { hostHelper } from '../shell/host.ts';

export interface DesktopHelperBridge {
  call<M extends HelperMethod>(method: M, params: HelperParams<M>): Promise<HelperResult<M>>;
}

export function desktopHelper(): DesktopHelperBridge | null {
  return hostHelper();
}
