// M5 甲路的变化在提交之后推给每条打开的事件流（shared/api/device-self-events.ts）：节点变了、记下一个设备动作（被拒的那一
// 句原因用户在这里看到）。2026-11-05 自迭代删掉，它的事件一起没了。

import type { AppDeps } from './context.ts';
import { nodeActionView, nodeView } from './device-views.ts';

export function attachDeviceStreams(deps: AppDeps): void {
  const { state, hub, devices } = deps;
  devices.attach({
    nodeChanged(nodeId) {
      const node = state.nodes.get(nodeId);
      if (node !== undefined) {
        hub.publish({ type: 'node_changed', node: nodeView(state, node, deps.now()) });
      }
    },
    actionRecorded(action) {
      hub.publish({ type: 'node_action_recorded', action: nodeActionView(action) });
      const node = state.nodes.get(action.nodeId);
      if (node !== undefined) {
        // The node's hourly usage moved with it.
        hub.publish({ type: 'node_changed', node: nodeView(state, node, deps.now()) });
      }
    },
  });
}
