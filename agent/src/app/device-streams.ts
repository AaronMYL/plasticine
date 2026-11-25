import type { AppDeps } from './context.ts';
import { nodeActionView, nodeView } from './device-views.ts';

export function attachDeviceStreams(deps: AppDeps): void {
  const { state, hub, devices } = deps;
  devices.attach({
    nodeChanged(nodeId) {
      const node = state.nodes.get(nodeId);
      if (node !== undefined) {
        hub.publish({ type: 'node_changed', node: nodeView(state, node, deps.now(), devices) });
      }
    },
    actionRecorded(action) {
      hub.publish({ type: 'node_action_recorded', action: nodeActionView(action) });
      const node = state.nodes.get(action.nodeId);
      if (node !== undefined) {
        hub.publish({ type: 'node_changed', node: nodeView(state, node, deps.now(), devices) });
      }
    },
  });
}
