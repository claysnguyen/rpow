import type {
  AuthRequestBody, AuthRequestResponse, MeResponse,
  ChallengeResponse, MintRequestBody, MintResponse,
  SendRequestBody, SendResponse, ActivityResponse, LedgerResponse,
} from '@rpow/shared';
import { loadConfig, loadSession } from './config.js';

export interface ApiError {
  status: number;
  error: string;
  message: string;
  retry_after?: number;
}

export class ApiClient {
  constructor(public baseUrl: string, public sessionToken: string | null) {}

  static async create(): Promise<ApiClient> {
    const cfg = await loadConfig();
    const sess = await loadSession();
    return new ApiClient(cfg.apiBaseUrl, sess);
  }

  private headers(json: boolean): Record<string, string> {
    const h: Record<string, string> = {};
    if (json) h['content-type'] = 'application/json';
    if (this.sessionToken) h['cookie'] = `rpow_session=${this.sessionToken}`;
    return h;
  }

  private async call<T>(method: string, path: string, body?: unknown, opts?: { manualRedirect?: boolean }): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: this.headers(body !== undefined),
      body: body !== undefined ? JSON.stringify(body) : undefined,
      redirect: opts?.manualRedirect ? 'manual' : 'follow',
    });
    if (!res.ok && !(opts?.manualRedirect && res.status >= 300 && res.status < 400)) {
      let parsed: { error?: string; message?: string; retry_after?: number } = {};
      try { parsed = await res.json() as typeof parsed; } catch { /* keep empty */ }
      throw {
        status: res.status,
        error: parsed.error ?? 'INTERNAL',
        message: parsed.message ?? res.statusText,
        retry_after: parsed.retry_after,
      } satisfies ApiError;
    }
    if (res.status === 204 || opts?.manualRedirect) return undefined as T;
    return await res.json() as T;
  }

  /** GET /auth/verify?token=… without following the redirect, so we can grab Set-Cookie. */
  async authVerifyAndCaptureCookie(token: string): Promise<string> {
    const res = await fetch(`${this.baseUrl}/auth/verify?token=${encodeURIComponent(token)}`, {
      method: 'GET',
      redirect: 'manual',
    });
    if (res.status >= 400) {
      let parsed: { error?: string; message?: string } = {};
      try { parsed = await res.json() as typeof parsed; } catch { /* noop */ }
      throw {
        status: res.status,
        error: parsed.error ?? 'INTERNAL',
        message: parsed.message ?? `verify failed (${res.status})`,
      } satisfies ApiError;
    }
    const cookies = typeof res.headers.getSetCookie === 'function'
      ? res.headers.getSetCookie()
      : (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')!] : []);
    for (const ck of cookies) {
      const m = /(?:^|;\s*)rpow_session=([^;]+)/.exec(ck);
      if (m) return m[1]!;
    }
    throw { status: 500, error: 'NO_COOKIE', message: 'server did not set rpow_session cookie' } satisfies ApiError;
  }

  authRequest(b: AuthRequestBody) { return this.call<AuthRequestResponse>('POST', '/auth/request', b); }
  me() { return this.call<MeResponse>('GET', '/me'); }
  logout() { return this.call<{ ok: true }>('POST', '/auth/logout'); }
  challenge() { return this.call<ChallengeResponse>('POST', '/challenge'); }
  mint(b: MintRequestBody) { return this.call<MintResponse>('POST', '/mint', b); }
  send(b: SendRequestBody) { return this.call<SendResponse>('POST', '/send', b); }
  activity() { return this.call<ActivityResponse>('GET', '/activity'); }
  ledger() { return this.call<LedgerResponse>('GET', '/ledger'); }
}

export function isApiError(e: unknown): e is ApiError {
  return typeof e === 'object' && e !== null && 'error' in e && 'message' in e;
}
