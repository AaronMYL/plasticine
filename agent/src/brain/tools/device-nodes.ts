import { Type } from 'typebox';
import type { DeviceService } from '../../devices/index.ts';
import { defineTool, type Tool } from './registry.ts';

export function createDeviceNodesTool(devices: Pick<DeviceService, 'listNodes'>): Tool {
  return defineTool({ name: 'device_nodes', label: '设备节点',
    description: 'Lists paired device node IDs, online state, capabilities and current device limits. ' +
      'Use the ID of an online node with device_action. Deletion needs a signed per-action approval. ' +
      'An iPhone node (platform ios) is often offline: its actions wait until the app is next opened.',
    parameters: Type.Object({}, { additionalProperties: false }),
    replay: 'safe', effect: 'read', permission: 'auto', roles: ['conversation', 'worker'], timeoutMs: 1_000,
    execute: () => Promise.resolve(JSON.stringify(devices.listNodes())),
  });
}
