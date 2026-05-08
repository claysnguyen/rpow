import { randomUUID } from 'node:crypto';
import { ApiClient, isApiError } from '../api.js';
import { c, die } from '../ui.js';

export async function sendCmd(args: string[]): Promise<void> {
  const recipient = args[0];
  const amountStr = args[1];
  if (!recipient || !amountStr) die('usage: rpow send <recipient_email> <amount>');
  if (!/^\d+$/.test(amountStr)) die('amount must be a positive integer');
  const amount = parseInt(amountStr, 10);
  if (amount <= 0) die('amount must be > 0');

  const api = await ApiClient.create();
  if (!api.sessionToken) die('not signed in. run: rpow login <email>');

  try {
    const r = await api.send({
      recipient_email: recipient,
      amount,
      idempotency_key: randomUUID(),
    });
    if (r.pending) {
      console.log(c.green(`+ pending claim ${amount} RPOW -> ${r.recipient_email}`));
      console.log(c.dim(`  ${r.recipient_email} has no rpow2 account yet — invited via email`));
      console.log(c.dim(`  tokens reserved for 30 days; transfer_id=${r.transfer_id}`));
    } else {
      console.log(c.green(`+ SENT ${amount} RPOW`) + c.dim(' -> ') + r.recipient_email);
      console.log(c.dim(`  transfer_id=${r.transfer_id}`));
    }
  } catch (e) {
    if (isApiError(e)) {
      if (e.error === 'INSUFFICIENT_BALANCE') die('not enough tokens in your wallet');
      if (e.status === 401) die('session expired. run: rpow login <email>');
      die(`${e.error}: ${e.message}`);
    }
    throw e;
  }
}
