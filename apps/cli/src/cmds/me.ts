import { ApiClient, isApiError } from '../api.js';
import { c, pad, panel, die } from '../ui.js';

export async function meCmd(_args: string[]): Promise<void> {
  const api = await ApiClient.create();
  if (!api.sessionToken) die('not signed in. run: rpow login <email>');
  try {
    const me = await api.me();
    const body = [
      `  EMAIL    : ${c.green(me.email)}`,
      `  BALANCE  : ${c.bold(c.green(pad(me.balance, 4, '0')))} ${c.dim('RPOW')}`,
      `  MINTED   : ${pad(me.minted, 4, '0')}`,
      `  SENT     : ${pad(me.sent, 4, '0')}`,
      `  RECEIVED : ${pad(me.received, 4, '0')}`,
    ].join('\n');
    console.log(panel('WALLET', body));
  } catch (e) {
    if (isApiError(e)) {
      if (e.status === 401) die('session expired or invalid. run: rpow login <email>');
      die(`${e.error}: ${e.message}`);
    }
    throw e;
  }
}
