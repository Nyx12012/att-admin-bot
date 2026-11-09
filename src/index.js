const fs = require('fs');
const path = require('path');
const autostart = require('./autostart');

const root = path.resolve(__dirname, '..');
const serverPid = autostart.serverPid();
if (serverPid || process.argv.includes('--log-file')) autostart.logToFile(path.join(root, 'logs', 'bot.log'));

function fail(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 18 || (major === 18 && minor < 17)) fail(`Node.js ${process.versions.node} is too old. Install Node 20 or newer from https://nodejs.org.`);

const config = require('./config');

function noEnvMessage() {
  const lines = [`No .env file in ${root}`, ''];
  const example = path.join(root, '.env.example');
  if (fs.existsSync(example) && /DISCORD_TOKEN=(?!PUT_)\S{20,}/.test(fs.readFileSync(example, 'utf8'))) {
    lines.push('Your token is in .env.example. Save a copy of that file named .env in the same folder.');
  } else {
    lines.push('Copy .env.example, name the copy .env and fill it in (SETUP.md, step 4).');
  }
  lines.push('The .env file goes in the same folder as start.bat, package.json and the src folder.');
  lines.push('Windows hides file endings by default, so a file that looks like ".env" can really be ".env.txt".');
  lines.push('In File Explorer use View, Show, File name extensions to check.');
  return lines.join('\n');
}

let cfg;
try {
  cfg = config.load();
} catch (e) {
  fail(`Settings problem: ${e.message}`);
}

if (!cfg.envFile && !process.env.DISCORD_TOKEN) fail(noEnvMessage());
if (cfg.envFile && cfg.envFile !== '.env') console.warn(`Read the settings from "${cfg.envFile}". It works, but rename it to .env when you can (SETUP.md, step 4).`);
if (!cfg.discordToken) fail(`DISCORD_TOKEN is empty in ${cfg.envFile || '.env'}. See SETUP.md, step 2.`);

let shutdown = async () => process.exit(0);
const held = autostart.lock(cfg.dataDir, {
  token: cfg.discordToken,
  onLost: (pid) => shutdown(`Another copy of this bot took over (process ${pid}), so this one stops.`),
});
if (!held.ok) fail(`This Discord bot is already running${held.pid ? ` (process ${held.pid})` : ''}. Close the other copy first.`);

for (const s of cfg.servers) {
  if (!s.guildId) console.warn(`Server "${s.id}" has no DISCORD_GUILD_ID, so no slash commands will show up for it.`);
  if (!s.token && !(s.tokenFile && fs.existsSync(s.tokenFile))) {
    console.warn(`Server "${s.id}": no console token yet (looked for ${s.tokenFile || 'nothing'}). Start the game server once, or paste the token into ATT_CONSOLE_TOKEN.`);
  }
}

const { Events } = require('discord.js');
const { Bot } = require('./bot');
const bot = new Bot(cfg);

if (process.argv.includes('--register-only')) {
  bot.client.once(Events.ClientReady, async () => {
    try {
      await bot.register();
    } catch (e) {
      console.error(e.message);
      process.exitCode = 1;
    }
    await bot.client.destroy();
  });
  bot.client.login(cfg.discordToken).catch((e) => fail(`Discord login failed: ${e.message}`));
} else {
  let stopping = false;
  shutdown = async (why) => {
    if (stopping) return;
    stopping = true;
    console.log(why || 'Stopping...');
    setTimeout(() => process.exit(0), 15000).unref();
    await bot.stop().catch(() => {});
    process.exit(0);
  };
  bot.life = autostart.lifecycle({ stop: () => bot.stop(), release: held.release, root });
  if (serverPid) console.log(`Started by BotCore for the game server (process ${serverPid}). The bot stays up until someone stops it.`);
  bot.start().catch((e) => fail(`Discord login failed: ${String(e.message).replace(/\.+$/, '')}. Check DISCORD_TOKEN in ${cfg.envFile || '.env'}.`));
  process.on('SIGINT', () => shutdown());
  process.on('SIGTERM', () => shutdown());
  process.on('unhandledRejection', (e) => console.error('[unhandled]', e));
  process.on('uncaughtException', (e) => console.error('[uncaught]', e));
}
