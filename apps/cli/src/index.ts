#!/usr/bin/env node
import { loginCmd } from './cmds/login.js';
import { meCmd } from './cmds/me.js';
import { mineCmd } from './cmds/mine.js';
import { benchCmd } from './cmds/bench.js';
import { sendCmd } from './cmds/send.js';
import { activityCmd } from './cmds/activity.js';
import { ledgerCmd } from './cmds/ledger.js';
import { logoutCmd } from './cmds/logout.js';
import { c, HEADER, die } from './ui.js';
import { configDir } from './config.js';

function printHelp(): void {
  console.log(HEADER);
  console.log();
  console.log('  ' + c.bold('USAGE'));
  console.log('    rpow <command> [args...]');
  console.log();
  console.log('  ' + c.bold('COMMANDS'));
  console.log(`    ${c.green('login')}     <email>                   send magic link, then paste the verify URL`);
  console.log(`    ${c.green('login')}     --url <verify_url>        non-interactive: exchange an existing URL/token`);
  console.log(`    ${c.green('me')}                                  show wallet balance + counters`);
  console.log(`    ${c.green('mine')}      [--count N | --forever] [--workers N]`);
  console.log(`                                          mine RPOW tokens (default count=1, workers=cpus-2)`);
  console.log(`    ${c.green('bench')}     [--workers N] [--seconds S] [--bits B]`);
  console.log(`                                          offline hashrate benchmark (no API calls)`);
  console.log(`    ${c.green('send')}      <email> <amount>          transfer N RPOW to another email`);
  console.log(`    ${c.green('activity')}                            show your last 100 activity entries`);
  console.log(`    ${c.green('ledger')}                              show public supply + difficulty stats`);
  console.log(`    ${c.green('logout')}                              clear local session and tell the server`);
  console.log(`    ${c.green('help')}                                show this message`);
  console.log();
  console.log('  ' + c.bold('CONFIG'));
  console.log(`    ${c.dim('config dir : ')}${configDir()}`);
  console.log(`    ${c.dim('api base   : ')}env RPOW_API or config.json apiBaseUrl (default https://api.rpow2.com)`);
  console.log();
  console.log('  ' + c.bold('EXAMPLES'));
  console.log(c.dim('    rpow login frk@example.com'));
  console.log(c.dim('    rpow mine --forever --workers 8'));
  console.log(c.dim('    rpow bench --seconds 15            # measure raw hashrate'));
  console.log(c.dim('    rpow send alice@x.com 5'));
  console.log(c.dim('    RPOW_API=http://localhost:8080 rpow me'));
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const rest = argv.slice(1);

  switch (cmd) {
    case undefined:
    case 'help':
    case '-h':
    case '--help':
      printHelp();
      return;
    case 'login':    return await loginCmd(rest);
    case 'me':       return await meCmd(rest);
    case 'mine':     return await mineCmd(rest);
    case 'bench':    return await benchCmd(rest);
    case 'send':     return await sendCmd(rest);
    case 'activity': return await activityCmd(rest);
    case 'ledger':   return await ledgerCmd(rest);
    case 'logout':   return await logoutCmd(rest);
    default:
      die(`unknown command: ${cmd}\n  run "rpow help" for usage`);
  }
}

main().catch((err) => {
  if (err && typeof err === 'object' && 'message' in err) die(String((err as { message: unknown }).message));
  die(String(err));
});
