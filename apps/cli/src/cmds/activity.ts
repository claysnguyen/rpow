import { ApiClient, isApiError } from '../api.js';
import { c, die, panel } from '../ui.js';

export async function activityCmd(_args: string[]): Promise<void> {
  const api = await ApiClient.create();
  if (!api.sessionToken) die('not signed in. run: rpow login <email>');

  try {
    const items = await api.activity();
    if (items.length === 0) {
      console.log(panel('ACTIVITY', '  ' + c.dim('(no activity yet)')));
      return;
    }
    const lines = items.map(e => {
      const when = e.at.replace('T', ' ').slice(0, 19);
      const tag = e.type === 'mint' ? c.green('MINT   ')
                : e.type === 'send' ? c.yellow('SEND   ')
                : c.cyan('RECEIVE');
      const sign = e.type === 'send' ? '-' : '+';
      const amt = `${sign}${e.amount}`.padStart(5);
      const who = e.counterparty_email ?? '';
      return `  ${c.dim(when)}  ${tag}  ${amt}  ${c.dim(who)}`;
    });
    console.log(panel('ACTIVITY (latest 100)', lines.join('\n')));
  } catch (e) {
    if (isApiError(e)) {
      if (e.status === 401) die('session expired. run: rpow login <email>');
      die(`${e.error}: ${e.message}`);
    }
    throw e;
  }
}
