import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdir, readFile, writeFile, rm, chmod } from 'node:fs/promises';

const DEFAULT_API = 'https://api.rpow2.com';

export interface CliConfig {
  apiBaseUrl: string;
}

export function configDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config');
  return join(xdg, 'rpow');
}

function configPath(): string { return join(configDir(), 'config.json'); }
function sessionPath(): string { return join(configDir(), 'session'); }

export async function loadConfig(): Promise<CliConfig> {
  const fromEnv = process.env.RPOW_API;
  try {
    const raw = await readFile(configPath(), 'utf8');
    const parsed = JSON.parse(raw) as Partial<CliConfig>;
    return { apiBaseUrl: fromEnv ?? parsed.apiBaseUrl ?? DEFAULT_API };
  } catch {
    return { apiBaseUrl: fromEnv ?? DEFAULT_API };
  }
}

export async function saveConfig(c: CliConfig): Promise<void> {
  await mkdir(configDir(), { recursive: true });
  await writeFile(configPath(), JSON.stringify(c, null, 2) + '\n', 'utf8');
}

export async function loadSession(): Promise<string | null> {
  try {
    const raw = (await readFile(sessionPath(), 'utf8')).trim();
    return raw || null;
  } catch {
    return null;
  }
}

export async function saveSession(token: string): Promise<void> {
  await mkdir(configDir(), { recursive: true });
  await writeFile(sessionPath(), token + '\n', 'utf8');
  // Best-effort restrict to user-only on POSIX. Ignore on Windows.
  try { await chmod(sessionPath(), 0o600); } catch { /* noop */ }
}

export async function clearSession(): Promise<void> {
  try { await rm(sessionPath()); } catch { /* noop */ }
}
