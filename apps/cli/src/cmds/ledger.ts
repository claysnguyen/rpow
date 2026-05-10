import { ApiClient, isApiError } from '../api.js';
import { fmtRpowFromBaseUnits } from '../units.js';
import { c, die, panel } from '../ui.js';

interface LedgerExtra {
  max_supply?: number;
  epoch?: number;
  next_milestone_at?: number;
  coins_until_next_milestone?: number;
  next_difficulty_bits?: number;
  is_capped?: boolean;
}

/** Prod / halving API: amounts as decimal string base units (9 decimals = 1 RPOW). */
interface LedgerBaseUnits {
  total_minted_base_units: string;
  total_transferred_base_units: string;
  circulating_supply_base_units: string;
  minted_supply_counter_base_units?: string;
  max_supply_base_units: string;
  base_units_per_rpow: string;
  current_difficulty_bits: number;
  current_reward_base_units: string;
  next_reward_base_units: string;
  next_halving_at_base_units: string;
  base_units_to_next_halving: string;
  halving_index: number;
  is_capped: boolean;
  user_count: number;
}

function isLedgerBaseUnits(d: object): d is LedgerBaseUnits {
  return 'total_minted_base_units' in d && typeof (d as LedgerBaseUnits).total_minted_base_units === 'string';
}

export async function ledgerCmd(_args: string[]): Promise<void> {
  const api = await ApiClient.create();
  try {
    const raw = (await api.ledger()) as object & LedgerExtra;
    let lines: string[];
    if (isLedgerBaseUnits(raw)) {
      const d = raw;
      lines = [
        `  TOTAL MINTED        : ${c.bold(fmtRpowFromBaseUnits(d.total_minted_base_units))} ${c.dim('RPOW')}`,
        `  TOTAL TRANSFERRED   : ${fmtRpowFromBaseUnits(d.total_transferred_base_units)} ${c.dim('RPOW')}`,
        `  CIRCULATING SUPPLY  : ${fmtRpowFromBaseUnits(d.circulating_supply_base_units)} ${c.dim('RPOW')}`,
        `  CURRENT REWARD      : ${fmtRpowFromBaseUnits(d.current_reward_base_units)} ${c.dim('RPOW / mint')}`,
        `  NEXT REWARD         : ${fmtRpowFromBaseUnits(d.next_reward_base_units)} ${c.dim('RPOW / mint')}`,
        `  NEXT HALVING AT     : ${fmtRpowFromBaseUnits(d.next_halving_at_base_units)} ${c.dim('RPOW minted (supply)')}`,
        `  TO NEXT HALVING     : ${fmtRpowFromBaseUnits(d.base_units_to_next_halving)} ${c.dim('RPOW')}`,
        `  HALVING INDEX       : ${d.halving_index}`,
        `  MAX SUPPLY          : ${fmtRpowFromBaseUnits(d.max_supply_base_units)} ${c.dim('RPOW')}`,
        `  CURRENT DIFFICULTY  : ${c.green(String(d.current_difficulty_bits))} ${c.dim('trailing zero bits')}`,
        `  USER COUNT          : ${d.user_count}`,
      ];
      if (d.is_capped) lines.push('  ' + c.red('CAPPED — no further mints allowed'));
    } else {
      const d = raw as Awaited<ReturnType<typeof api.ledger>> & LedgerExtra;
      lines = [
        `  TOTAL MINTED        : ${c.bold(String(d.total_minted))}`,
        `  TOTAL TRANSFERRED   : ${d.total_transferred}`,
        `  CIRCULATING SUPPLY  : ${d.circulating_supply}`,
        `  CURRENT DIFFICULTY  : ${c.green(String(d.current_difficulty_bits))} ${c.dim('trailing zero bits')}`,
        `  USER COUNT          : ${d.user_count}`,
      ];
      if (typeof d.max_supply === 'number') {
        lines.push('');
        lines.push(`  MAX SUPPLY          : ${d.max_supply.toLocaleString()}`);
        lines.push(`  EPOCH               : ${d.epoch}`);
        lines.push(`  NEXT MILESTONE      : ${d.next_milestone_at?.toLocaleString()}  ${c.dim(`(${d.coins_until_next_milestone?.toLocaleString()} to go)`)}`);
        lines.push(`  NEXT DIFFICULTY     : ${d.next_difficulty_bits} ${c.dim('bits')}`);
        if (d.is_capped) lines.push('  ' + c.red('CAPPED — no further mints allowed'));
      }
    }
    console.log(panel('PUBLIC LEDGER', lines.join('\n')));
  } catch (e) {
    if (isApiError(e)) die(`${e.error}: ${e.message}`);
    throw e;
  }
}
