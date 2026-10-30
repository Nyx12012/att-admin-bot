const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
require('dotenv').config({ path: path.join(root, '.env'), quiet: true });

function env(name, fallback = '') {
  const v = process.env[name];
  if (v == null) return fallback;
  const t = String(v).trim();
  return t === '' || /^PUT_/.test(t) ? fallback : t;
}

function defaultTokenFile() {
  if (process.env.APPDATA) return path.join(process.env.APPDATA, 'TheModdingTavern', 'console_token.txt');
  return '';
}

function readServers() {
  const file = path.join(root, 'servers.json');
  if (fs.existsSync(file)) {
    const list = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(list) || list.length === 0) throw new Error('servers.json must be a list with at least one server');
    return list.map((s, i) => normalizeServer(s, i));
  }
  return [normalizeServer({
    id: env('SERVER_ID', 'main'),
    name: env('SERVER_NAME', 'My Server'),
    guildId: env('DISCORD_GUILD_ID'),
    host: env('ATT_CONSOLE_HOST', '127.0.0.1'),
    port: env('ATT_CONSOLE_PORT', '1760'),
    token: env('ATT_CONSOLE_TOKEN'),
    tokenFile: env('ATT_CONSOLE_TOKEN_FILE', defaultTokenFile()),
  }, 0)];
}

function normalizeServer(s, i) {
  const id = String(s.id || `server${i + 1}`).toLowerCase().replace(/[^a-z0-9_-]/g, '');
  if (!id) throw new Error(`server ${i + 1} needs an id made of letters, digits, _ or -`);
  return {
    id,
    name: String(s.name || id),
    guildId: String(s.guildId || ''),
    host: String(s.host || '127.0.0.1'),
    port: Number(s.port || 1760),
    token: s.token ? String(s.token) : '',
    tokenFile: s.tokenFile ? String(s.tokenFile) : defaultTokenFile(),
  };
}

function load() {
  return {
    root,
    dataDir: path.resolve(root, env('DATA_DIR', 'data')),
    discordToken: env('DISCORD_TOKEN'),
    ownerIds: env('BOT_OWNER_IDS').split(/[\s,]+/).filter(Boolean),
    servers: readServers(),
  };
}

module.exports = { load, root };
