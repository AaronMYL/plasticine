// /v2/device-keys 的真实现：读这台设备登记过的公钥、登记一把。登记的请求体原样发（服务端按它的摘要去重）。

import type { DeviceKeysApi } from '../client.ts';
import { DEVICE_KEYS_PATH, DeviceKeyResponseSchema } from '../shared.ts';
import type { DeviceKeyView } from '../types.ts';
import { badResponseError } from '../errors.ts';
import type { Transport } from './transport.ts';

export class HttpDeviceKeys implements DeviceKeysApi {
  private readonly transport: Transport;

  constructor(transport: Transport) {
    this.transport = transport;
  }

  async current(signal?: AbortSignal): Promise<DeviceKeyView | null> {
    const response = await this.transport.request({
      method: 'GET',
      path: DEVICE_KEYS_PATH,
      schema: DeviceKeyResponseSchema,
      what: '读签名钥匙',
      lostAs: 'failed',
      signal,
    });
    return response.key;
  }

  async register(bodyText: string): Promise<DeviceKeyView> {
    const response = await this.transport.request({
      method: 'POST',
      path: DEVICE_KEYS_PATH,
      rawBody: bodyText,
      schema: DeviceKeyResponseSchema,
      what: '登记签名钥匙',
      lostAs: 'uncertain',
    });
    if (response.key === null) {
      throw badResponseError('登记签名钥匙', '登记成功的回答里没有钥匙', true);
    }
    return response.key;
  }
}
