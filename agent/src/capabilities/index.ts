import { Value } from 'typebox/value';
import { CapabilityProbeSchema, type Capability, type CapabilityProbe } from '../../shared/capabilities.ts';

/** Adapters describe actual transports. An MCP or external-agent adapter must implement probing before registration. */
export interface CapabilityAdapter {
  id: string;
  label: string;
  tools: string[];
  enabled(): boolean;
  inspect(signal: AbortSignal): Promise<CapabilityProbe>;
}

export class CapabilityCatalog {
  readonly #adapters = new Map<string, CapabilityAdapter>();

  has(id: string): boolean { return this.#adapters.has(id); }

  register(adapter: CapabilityAdapter): void {
    if (this.#adapters.has(adapter.id)) { throw new Error(`能力 ${adapter.id} 重复注册。`); }
    this.#adapters.set(adapter.id, adapter);
  }

  async inspect(signal: AbortSignal, id?: string): Promise<Capability[]> {
    signal.throwIfAborted();
    const adapters = [...this.#adapters.values()].filter((adapter) => id === undefined || adapter.id === id);
    if (id !== undefined && adapters.length === 0) { throw new Error('没有这项能力，请先读取完整能力目录。'); }
    return Promise.all(adapters.map(async (adapter): Promise<Capability> => {
      let probe: CapabilityProbe;
      try {
        probe = await adapter.inspect(signal);
        if (!Value.Check(CapabilityProbeSchema, probe)) { throw new Error('能力探测结果格式不对。'); }
      } catch {
        signal.throwIfAborted();
        probe = { supported: true, configured: true, connected: false,
          detail: '暂时连不上，恢复连接后可以继续使用。' };
      }
      const enabled = adapter.enabled();
      const status = !probe.supported ? 'unsupported' : !enabled ? 'disabled' : !probe.configured ? 'not_configured'
        : probe.connected === null ? 'unknown' : probe.connected ? 'ready' : 'disconnected';
      return { id: adapter.id, label: adapter.label, tools: adapter.tools, enabled, ...probe,
        ready: status === 'ready', status, checkedAt: new Date().toISOString() };
    }));
  }
}
