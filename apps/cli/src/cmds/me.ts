import { ApiClient, isApiError } from '../api.js';
import { fmtRpowFromBaseUnits } from '../units.js';
import { c, pad, panel, die } from '../ui.js';

interface MeBaseUnits {
  email: string;
  balance_base_units: string;
  minted_base_units: string;
  sent_base_units: string;
  received_base_units: string;
  wrap_allowed?: boolean;
  solana_wallet?: string | null;
  srpow_supply_owned_base_units?: string;
  daily_mint_cap_base_units?: string;
  daily_minted_base_units?: string;
  daily_remaining_base_units?: string;
}

function isMeBaseUnits(m: object): m is MeBaseUnits {
  return 'balance_base_units' in m && typeof (m as MeBaseUnits).balance_base_units === 'string';
}

export async function meCmd(_args: string[]): Promise<void> {
  const api = await ApiClient.create();
  if (!api.sessionToken) die('not signed in. run: rpow login <email>');
  try {
    const raw = await api.me() as object;
    let body: string;
    if (isMeBaseUnits(raw)) {
      const me = raw;
      const lines = [
        `  EMAIL    : ${c.green(me.email)}`,
        `  BALANCE  : ${c.bold(c.green(fmtRpowFromBaseUnits(me.balance_base_units)))} ${c.dim('RPOW')}`,
        `  MINTED   : ${fmtRpowFromBaseUnits(me.minted_base_units)} ${c.dim('RPOW')}`,
        `  SENT     : ${fmtRpowFromBaseUnits(me.sent_base_units)} ${c.dim('RPOW')}`,
        `  RECEIVED : ${fmtRpowFromBaseUnits(me.received_base_units)} ${c.dim('RPOW')}`,
      ];
      if (me.daily_remaining_base_units != null && me.daily_mint_cap_base_units != null) {
        lines.push(
          `  MINT QUOTA TODAY : ${fmtRpowFromBaseUnits(me.daily_remaining_base_units)} / ${fmtRpowFromBaseUnits(me.daily_mint_cap_base_units)} ${c.dim('RPOW left (UTC day)')}`,
        );
      }
      if (me.srpow_supply_owned_base_units != null && BigInt(me.srpow_supply_owned_base_units || '0') > 0n) {
        lines.push(`  SRPOW (WRAPPED)  : ${fmtRpowFromBaseUnits(me.srpow_supply_owned_base_units)} ${c.dim('RPOW')}`);
      }
      if (me.solana_wallet) {
        lines.push(`  SOLANA           : ${c.dim(me.solana_wallet)}`);
      }
      if (typeof me.wrap_allowed === 'boolean') {
        lines.push(`  WRAP ALLOWED     : ${me.wrap_allowed ? c.green('yes') : c.dim('no')}`);
      }
      body = lines.join('\n');
    } else {
      const me = raw as Awaited<ReturnType<typeof api.me>>;
      body = [
        `  EMAIL    : ${c.green(me.email)}`,
        `  BALANCE  : ${c.bold(c.green(pad(me.balance, 4, '0')))} ${c.dim('RPOW')}`,
        `  MINTED   : ${pad(me.minted, 4, '0')}`,
        `  SENT     : ${pad(me.sent, 4, '0')}`,
        `  RECEIVED : ${pad(me.received, 4, '0')}`,
      ].join('\n');
    }
    console.log(panel('WALLET', body));
  } catch (e) {
    if (isApiError(e)) {
      if (e.status === 401) die('session expired or invalid. run: rpow login <email>');
      die(`${e.error}: ${e.message}`);
    }
    throw e;
  }
}
