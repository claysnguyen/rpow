export const BASE_UNITS_PER_RPOW = 1_000_000_000n;

/** Format 9-decimal base-unit string as RPOW (no thousands separators). */
export function fmtRpowFromBaseUnits(s: string): string {
  let b: bigint;
  try {
    b = BigInt(s);
  } catch {
    return s;
  }
  const neg = b < 0n;
  if (neg) b = -b;
  const intPart = b / BASE_UNITS_PER_RPOW;
  let frac = (b % BASE_UNITS_PER_RPOW).toString().padStart(9, '0');
  frac = frac.replace(/0+$/, '');
  const core = frac ? `${intPart}.${frac}` : intPart.toString();
  return neg ? `-${core}` : core;
}
