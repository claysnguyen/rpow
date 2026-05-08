const useColor = process.stdout.isTTY && !process.env.NO_COLOR;

const wrap = (code: number) => (s: string | number): string =>
  useColor ? `\x1b[${code}m${s}\x1b[0m` : String(s);

export const c = {
  bold: wrap(1),
  dim: wrap(2),
  red: wrap(31),
  green: wrap(32),
  yellow: wrap(33),
  cyan: wrap(36),
  magenta: wrap(35),
};

export const HEADER = [
  '+----------------------------------------------------------+',
  '|        rpow CLI - Reusable Proofs of Work, terminal      |',
  '+----------------------------------------------------------+',
].join('\n');

export function panel(title: string, body: string): string {
  const t = ` ${title} `;
  const fill = Math.max(2, 58 - t.length);
  const top = `+--${t}${'-'.repeat(fill)}+`;
  const bot = `+${'-'.repeat(top.length - 2)}+`;
  return [c.cyan(top), body, c.cyan(bot)].join('\n');
}

export function pad(s: string | number, n: number, padChar = ' '): string {
  const str = String(s);
  if (str.length >= n) return str;
  return padChar.repeat(n - str.length) + str;
}

export function fmtRate(hashes: bigint, elapsedMs: number): string {
  if (elapsedMs <= 0) return '0';
  const mhs = Number(hashes) / 1e6 / (elapsedMs / 1000);
  return mhs.toFixed(2) + ' MH/s';
}

export function fmtElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  const hh = String(Math.floor(total / 3600)).padStart(2, '0');
  const mm = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  const ss = String(total % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

/** Render a single-line progress in-place using carriage-return. */
export function progressLine(text: string): void {
  if (!process.stdout.isTTY) return;
  process.stdout.write('\r\x1b[2K' + text);
}

export function progressDone(): void {
  if (!process.stdout.isTTY) return;
  process.stdout.write('\n');
}

export function die(msg: string, code = 1): never {
  process.stderr.write(c.red('error: ') + msg + '\n');
  process.exit(code);
}
