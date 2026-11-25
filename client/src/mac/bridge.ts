import type { MacAttachedFile, PlasticineMacBridge } from '../api/shared.ts';
import type { DesktopHelperBridge } from './desktop-helper.ts';

export type HostBridge = PlasticineMacBridge & { helper?: DesktopHelperBridge };

declare global {
  interface Window {
    plasticineDesktop?: HostBridge;
    __plasticineAttachFiles?: (files: MacAttachedFile[]) => Promise<void>;
    __plasticineFocusComposer?: () => void;
    __plasticineNewNote?: () => Promise<void>;
    __plasticineWebTabEvent?: (event: unknown) => void;
    __plasticineWebMenu?: (command: unknown) => void;
    __plasticineQuoteSelection?: (command: unknown) => void;
  }
}

export {};
