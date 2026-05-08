import { ApiClient } from '../api.js';
import { clearSession } from '../config.js';
import { c } from '../ui.js';

export async function logoutCmd(_args: string[]): Promise<void> {
  const api = await ApiClient.create();
  if (api.sessionToken) {
    try { await api.logout(); } catch { /* server-side clear is best-effort */ }
  }
  await clearSession();
  console.log(c.green('+ logged out') + c.dim(' (local session removed)'));
}
