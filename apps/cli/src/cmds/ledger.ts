import { ApiClient, isApiError } from '../api.js';
import { c, die, panel } from '../ui.js';

interface LedgerExtra {
  max_supply?: number;
  epoch?: number;
  next_milestone_at?: number;
  coins_until_next_milestone?: number;
  next_difficulty_bits?: number;
  is_capped?: boolean;
}

export async function ledgerCmd(_args: string[]): Promise<void> {
  const api = await ApiClient.create();
  try {
    const d = await api.ledger() as Awaited<ReturnType<typeof api.ledger>> & LedgerExtra;
    const lines = [
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
    console.log(panel('PUBLIC LEDGER', lines.join('\n')));
  } catch (e) {
    if (isApiError(e)) die(`${e.error}: ${e.message}`);
    throw e;
  }
}
