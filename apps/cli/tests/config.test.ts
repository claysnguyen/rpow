import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, saveConfig, loadSession, saveSession, clearSession, configDir } from '../src/config.js';

let tmp: string;
let originalXdg: string | undefined;
let originalApi: string | undefined;

beforeEach(() => {
  originalXdg = process.env.XDG_CONFIG_HOME;
  originalApi = process.env.RPOW_API;
  tmp = mkdtempSync(join(tmpdir(), 'rpow-cli-test-'));
  process.env.XDG_CONFIG_HOME = tmp;
  delete process.env.RPOW_API;
});

afterEach(() => {
  if (originalXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = originalXdg;
  if (originalApi === undefined) delete process.env.RPOW_API;
  else process.env.RPOW_API = originalApi;
  rmSync(tmp, { recursive: true, force: true });
});

describe('config', () => {
  it('configDir() respects XDG_CONFIG_HOME', () => {
    expect(configDir()).toBe(join(tmp, 'rpow'));
  });

  it('returns default api when nothing is set', async () => {
    const c = await loadConfig();
    expect(c.apiBaseUrl).toBe('https://api.rpow2.com');
  });

  it('round-trips saveConfig + loadConfig', async () => {
    await saveConfig({ apiBaseUrl: 'http://localhost:8080' });
    const c = await loadConfig();
    expect(c.apiBaseUrl).toBe('http://localhost:8080');
  });

  it('RPOW_API env wins over saved config', async () => {
    await saveConfig({ apiBaseUrl: 'http://localhost:8080' });
    process.env.RPOW_API = 'http://127.0.0.1:9999';
    const c = await loadConfig();
    expect(c.apiBaseUrl).toBe('http://127.0.0.1:9999');
  });
});

describe('session', () => {
  it('returns null when no session file exists', async () => {
    expect(await loadSession()).toBeNull();
  });

  it('round-trips saveSession + loadSession', async () => {
    await saveSession('abc.def');
    expect(await loadSession()).toBe('abc.def');
  });

  it('clearSession removes the file', async () => {
    await saveSession('abc.def');
    await clearSession();
    expect(await loadSession()).toBeNull();
  });
});
