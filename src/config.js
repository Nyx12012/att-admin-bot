const fs = require('fs');
const path = require('path');

const dotenv = require('dotenv');

const root = path.resolve(__dirname, '..');
const ENV_NAMES = ['.env', '.env.txt', 'env', 'env.txt'];
const BOM = String.fromCharCode(0xfeff);

function decode(buf) {
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString('utf16le');
  if (buf[0] === 0xfe && buf[1] === 0xff) {
    const body = Buffer.from(buf.subarray(2, buf.length - (buf.length % 2)));
    return body.swap16().toString('utf16le');
  }
  const text = buf.toString('utf8');
  return text.startsWith(BOM) ? text.slice(1) : text;
}

function readEnvFile(dir) {
  for (const name of ENV_NAMES) {
    const file = path.join(dir, name);
    try {
      if (!fs.statSync(file).isFile()) continue;
    } catch {
      continue;
    }
    return { name, file, vars: dotenv.parse(decode(fs.readFileSync(file))) };
  }
  return null;
}

const envFile = readEnvFile(root);
if (envFile) {
  for (const [k, v] of Object.entries(envFile.vars)) if (process.env[k] === undefined) process.env[k] = v;
}

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
    start: env('SERVER_START'),
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
    start: s.start ? String(s.start) : '',
  };
}

function load() {
  return {
    root,
    envFile: envFile ? envFile.name : null,
    dataDir: path.resolve(root, env('DATA_DIR', 'data')),
    discordToken: env('DISCORD_TOKEN'),
    ownerIds: env('BOT_OWNER_IDS').split(/[\s,]+/).filter(Boolean),
    servers: readServers(),
  };
}

module.exports = { load, root, readEnvFile, decode };
