// 竖排网页标签和网站图标的接口签名（11-08，服务端 agent/src/app/web-tabs.ts）：http/web-tabs.ts 是真实现，
// fake/fake-web-tabs.ts 给本机开发和测试用。形状都在 agent/shared/api/web-tabs.ts、favicons.ts。

import type {
  MergeWebTabsRequest,
  PutFaviconRequest,
  PutFaviconResponse,
  PutWebTabsRequest,
  PutWebTabsResponse,
  WebTabsResponse,
} from './shared.ts';

export interface WebTabsApi {
  /** GET /v2/web-tabs：现在那一份摆放和版本。 */
  get(signal?: AbortSignal): Promise<WebTabsResponse>;
  /** PUT /v2/web-tabs：整份换；版本过时是 ConflictError<WebTabsResponse>（带现在那一份）。 */
  put(input: PutWebTabsRequest): Promise<PutWebTabsResponse>;
  /** POST /v2/web-tabs/merge：这台设备上还没搬上来的旧存档并进去，回合并后的整份。 */
  merge(input: MergeWebTabsRequest): Promise<WebTabsResponse>;
  /** PUT /v2/favicon：桌面壳报来的网站图标按页面的域名存进本体（别的设备也用上）。 */
  rememberIcon(input: PutFaviconRequest): Promise<PutFaviconResponse>;
  /** 这个域名的网站图标地址（<img src>）；拿不到图标的环境是 null（界面画首字母）。 */
  faviconSrc(host: string): string | null;
}
