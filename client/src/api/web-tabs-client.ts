import type {
  MergeWebTabsRequest,
  PutFaviconRequest,
  PutFaviconResponse,
  PutWebTabsRequest,
  PutWebTabsResponse,
  WebTabsResponse,
} from './shared.ts';

export interface WebTabsApi {
  get(signal?: AbortSignal): Promise<WebTabsResponse>;
  put(input: PutWebTabsRequest): Promise<PutWebTabsResponse>;
  merge(input: MergeWebTabsRequest): Promise<WebTabsResponse>;
  rememberIcon(input: PutFaviconRequest): Promise<PutFaviconResponse>;
  faviconSrc(host: string): string | null;
}
