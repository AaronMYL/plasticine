import { TAVILY_FREE_MONTHLY } from '../shared.ts';
import type { SaveWebSearchRequest, TestWebSearchRequest, WebSearchStatus, WebSearchTestResponse } from '../shared.ts';
import type { WebSearchApi } from '../web-search-client.ts';
import type { FakeSession } from './fake-session.ts';

export class FakeWebSearch implements WebSearchApi {
  private state: WebSearchStatus = { provider: 'tavily', configured: false, keyHint: null, usedThisMonth: 0,
    monthlyFree: TAVILY_FREE_MONTHLY, testedAt: null, testOk: null };
  private readonly session: FakeSession;
  private readonly now: () => Date;

  constructor(session: FakeSession, now: () => Date) {
    this.session = session;
    this.now = now;
  }

  async status(): Promise<WebSearchStatus> {
    this.session.require();
    return this.state;
  }

  async save(input: SaveWebSearchRequest): Promise<WebSearchStatus> {
    this.session.requireUser();
    this.state = input.apiKey === null
      ? { ...this.state, configured: false, keyHint: null, testedAt: null, testOk: null }
      : { ...this.state, configured: true, keyHint: `…${input.apiKey.slice(-4)}`, testedAt: null, testOk: null };
    return this.state;
  }

  async test(_input: TestWebSearchRequest): Promise<WebSearchTestResponse> {
    this.session.requireUser();
    if (!this.state.configured) return { ok: false, error: '还没填密钥。', status: this.state };
    this.state = { ...this.state, testedAt: this.now().toISOString(), testOk: true,
      usedThisMonth: this.state.usedThisMonth + 1 };
    return { ok: true, error: null, status: this.state };
  }
}
