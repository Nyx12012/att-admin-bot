const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { readEnvFile } = require('../src/config');
const autostart = require('../src/autostart');
const { tempDir } = require('./fake');

test('a .env saved as .env.txt is still read', () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, '.env.txt'), 'DISCORD_TOKEN=abc\n');
  const r = readEnvFile(dir);
  assert.strictEqual(r.name, '.env.txt');
  assert.strictEqual(r.vars.DISCORD_TOKEN, 'abc');
});

test('.env wins over .env.txt', () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, '.env.txt'), 'DISCORD_TOKEN=old\n');
  fs.writeFileSync(path.join(dir, '.env'), 'DISCORD_TOKEN=new\n');
  assert.strictEqual(readEnvFile(dir).vars.DISCORD_TOKEN, 'new');
});

test('a byte order mark does not hide the first setting', () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, '.env'), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('DISCORD_TOKEN=abc\r\nDISCORD_GUILD_ID=1\r\n')]));
  const v = readEnvFile(dir).vars;
  assert.strictEqual(v.DISCORD_TOKEN, 'abc');
  assert.strictEqual(v.DISCORD_GUILD_ID, '1');
});

test('a .env saved as Unicode by Notepad is read', () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, '.env'), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('DISCORD_TOKEN=abc\r\n', 'utf16le')]));
  assert.strictEqual(readEnvFile(dir).vars.DISCORD_TOKEN, 'abc');
});

test('no settings file gives null', () => {
  assert.strictEqual(readEnvFile(tempDir()), null);
});

test('the server process id comes from the argument or the environment', () => {
  assert.strictEqual(autostart.serverPid(['node', 'x', '--server-pid', '1234'], {}), 1234);
  assert.strictEqual(autostart.serverPid(['node', 'x'], { ATT_SERVER_PID: '77' }), 77);
  assert.strictEqual(autostart.serverPid(['node', 'x', '--server-pid', 'abc'], {}), null);
});

test('a second copy of the bot is refused while the first is alive', async () => {
  const dir = tempDir();
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 5000)']);
  fs.writeFileSync(path.join(dir, 'bot.pid'), String(child.pid));
  const r = autostart.lock(dir);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.pid, child.pid);
  child.kill();
  await new Promise((res) => child.on('exit', res));
  const again = autostart.lock(dir);
  assert.strictEqual(again.ok, true);
  assert.strictEqual(fs.readFileSync(path.join(dir, 'bot.pid'), 'utf8'), String(process.pid));
  again.release();
  assert.ok(!fs.existsSync(path.join(dir, 'bot.pid')));
});

test('a stale lock file from a crash does not block the start', () => {
  const dir = tempDir();
  const file = path.join(dir, 'bot.pid');
  fs.writeFileSync(file, String(process.ppid));
  const old = new Date(Date.now() - 600000);
  fs.utimesSync(file, old, old);
  const r = autostart.lock(dir);
  assert.strictEqual(r.ok, true);
  r.release();
});

test('the bot notices when the game server process is gone', async () => {
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 300)']);
  const gone = await new Promise((res) => {
    const t = autostart.watch(child.pid, () => res(true), 50);
    setTimeout(() => { clearInterval(t); res(false); }, 5000);
  });
  assert.strictEqual(gone, true);
});
