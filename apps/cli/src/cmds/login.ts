import readline from 'node:readline/promises';
import { ApiClient, isApiError } from '../api.js';
import { saveSession } from '../config.js';
import { c, die } from '../ui.js';

function extractToken(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const m = /[?&]token=([^&\s#]+)/.exec(trimmed);
  if (m) return decodeURIComponent(m[1]!);
  // Treat as raw token (base64url chars only).
  if (/^[A-Za-z0-9_-]+$/.test(trimmed)) return trimmed;
  return null;
}

interface LoginFlags {
  email: string | null;
  url: string | null;
}

function parseFlags(args: string[]): LoginFlags {
  const out: LoginFlags = { email: null, url: null };
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === '--url' || a === '-u') {
      const v = args[++i];
      if (!v) die('--url requires a value (the verify URL or token from the email)');
      out.url = v;
      continue;
    }
    if (a.startsWith('--')) die(`unknown flag: ${a}`);
    if (out.email) die(`unexpected extra arg: ${a}`);
    out.email = a;
  }
  return out;
}

async function exchangeAndSave(api: ApiClient, raw: string): Promise<void> {
  const token = extractToken(raw);
  if (!token) die('could not parse a token from input');
  let cookieValue: string;
  try {
    cookieValue = await api.authVerifyAndCaptureCookie(token);
  } catch (e) {
    if (isApiError(e)) die(`${e.error}: ${e.message}`);
    throw e;
  }
  await saveSession(cookieValue);
  console.log();
  console.log(c.green('+ logged in'));
  console.log(c.dim('  session saved (~/.config/rpow/session, mode 0600)'));
  console.log(c.dim('  try: ') + 'rpow me');
}

export async function loginCmd(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const api = await ApiClient.create();

  // Non-interactive path: user already has a verify URL, skip sending a new email.
  if (flags.url) {
    if (flags.email) die('use either <email> (to send a link) OR --url (to exchange one), not both');
    await exchangeAndSave(api, flags.url);
    return;
  }

  if (!flags.email) {
    die('usage: rpow login <email>\n         rpow login --url "<verify_url>"');
  }

  try {
    await api.authRequest({ email: flags.email });
  } catch (e) {
    if (isApiError(e)) {
      if (e.error === 'RATE_LIMITED') die(`${e.message} (retry in ~${e.retry_after}s)`);
      die(`${e.error}: ${e.message}`);
    }
    throw e;
  }

  console.log(c.green('+ magic link sent') + ` to ${flags.email}`);
  console.log(c.dim('  open the link in the email, then paste the FULL URL below'));
  console.log(c.dim(`  (it looks like ${api.baseUrl}/auth/verify?token=...)`));
  console.log(c.dim('  (or rerun with: rpow login --url "<the URL>")'));
  console.log();

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ans = await rl.question(c.cyan('> paste verify URL or token: '));
  rl.close();
  await exchangeAndSave(api, ans);
}
