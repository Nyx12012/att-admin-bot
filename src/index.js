const fs = require('fs');
const path = require('path');
const config = require('./config');

function fail(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 18 || (major === 18 && minor < 17)) fail(`Node.js ${process.versions.node} is too old. Install Node 20 or newer from https://nodejs.org.`);

let cfg;
try {
  cfg = config.load();
} catch (e) {
  fail(`Settings problem: ${e.message}`);
}

if (!fs.existsSync(path.join(cfg.root, '.env')) && !process.env.DISCORD_TOKEN) {
  fail('No .env file found. Copy .env.example to .env and fill it in (see SETUP.md).');
}
if (!cfg.discordToken) fail('DISCORD_TOKEN is empty in .env. See SETUP.md, step 2.');
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
  bot.start().catch((e) => fail(`Discord login failed: ${e.message}. Check DISCORD_TOKEN in .env.`));
  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    console.log('Stopping...');
    await bot.stop().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('unhandledRejection', (e) => console.error('[unhandled]', e));
  process.on('uncaughtException', (e) => console.error('[uncaught]', e));
}
