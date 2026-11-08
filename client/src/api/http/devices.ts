// /v2/devices 的真实现：列出配对过的设备，撤销一台（服务端天然幂等：撤销两次回答一样，所以不带 requestId）。

import type { DevicesApi } from '../client.ts';
import { DeviceListResponseSchema, DEVICES_PATH, RevokeDeviceResponseSchema,
  BrowserPairingCodeResponseSchema, BrowserPairingStatusSchema } from '../shared.ts';
import type { DeviceView } from '../types.ts';
import type { Transport } from './transport.ts';

export class HttpDevices implements DevicesApi {
  private readonly transport: Transport;

  constructor(transport: Transport) {
    this.transport = transport;
  }

  async list(signal?: AbortSignal): Promise<DeviceView[]> {
    const response = await this.transport.request({
      method: 'GET',
      path: DEVICES_PATH,
      schema: DeviceListResponseSchema,
      what: '读设备列表',
      lostAs: 'failed',
      signal,
    });
    return response.devices;
  }

  async revoke(id: string): Promise<DeviceView> {
    const response = await this.transport.request({
      method: 'DELETE',
      path: `${DEVICES_PATH}/${encodeURIComponent(id)}`,
      schema: RevokeDeviceResponseSchema,
      what: '撤销设备',
      lostAs: 'uncertain',
    });
    return response.device;
  }

  issuePairingCode() {
    return this.transport.request({ method: 'POST', path: `${DEVICES_PATH}/pairing-codes`,
      schema: BrowserPairingCodeResponseSchema, what: '生成配对邀请', lostAs: 'failed' });
  }

  pairingStatus(id: string, signal?: AbortSignal) {
    return this.transport.request({ method: 'GET',
      path: `${DEVICES_PATH}/pairing-codes/${encodeURIComponent(id)}`,
      schema: BrowserPairingStatusSchema, what: '读取配对进度', lostAs: 'failed', signal });
  }
}
