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

function napping(ms) {
  return spawn(process.execPath, ['-e', `setTimeout(() => {}, ${ms})`]);
}

function wait(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

test('the same Discord token is refused from another folder', async () => {
  const shared = tempDir();
  const child = napping(20000);
  fs.writeFileSync(autostart.tokenFile('abc', shared), String(child.pid));
  const r = autostart.lock(tempDir(), { token: 'abc', shared });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.pid, child.pid);
  const other = autostart.lock(tempDir(), { token: 'xyz', shared });
  assert.strictEqual(other.ok, true);
  other.release();
  assert.ok(!fs.existsSync(autostart.tokenFile('xyz', shared)));
  child.kill();
  await new Promise((res) => child.on('exit', res));
  const after = autostart.lock(tempDir(), { token: 'abc', shared });
  assert.strictEqual(after.ok, true);
  after.release();
});

test('a refused folder lock frees the token lock', async () => {
  const shared = tempDir();
  const dir = tempDir();
  const child = napping(20000);
  fs.writeFileSync(path.join(dir, 'bot.pid'), String(child.pid));
  const r = autostart.lock(dir, { token: 'abc', shared });
  assert.strictEqual(r.ok, false);
  assert.ok(!fs.existsSync(autostart.tokenFile('abc', shared)));
  child.kill();
  await new Promise((res) => child.on('exit', res));
});

test('a failed heartbeat does not lose the lock', () => {
  const file = path.join(tempDir(), 'bot.pid');
  const lost = () => assert.fail('it should not count as lost');
  fs.mkdirSync(file);
  assert.doesNotThrow(() => autostart.beat(file, lost));
  fs.rmdirSync(file);
  autostart.beat(file, lost);
  assert.strictEqual(fs.readFileSync(file, 'utf8'), String(process.pid));
});

test('a copy that lost the lock to a live copy is told to stop', async () => {
  const file = path.join(tempDir(), 'bot.pid');
  const child = napping(20000);
  fs.writeFileSync(file, String(child.pid));
  let seen = null;
  autostart.beat(file, (pid) => { seen = pid; });
  assert.strictEqual(seen, child.pid);
  child.kill();
  await new Promise((res) => child.on('exit', res));
  seen = null;
  autostart.beat(file, (pid) => { seen = pid; });
  assert.strictEqual(seen, null);
  assert.strictEqual(fs.readFileSync(file, 'utf8'), String(process.pid));
});

test('the bot stays up while a server is connected, and stops after the limit without one', async () => {
  let online = true;
  let idled = false;
  const t = autostart.watch({ pid: null, online: () => online, onIdle: () => { idled = true; }, limit: 200, every: 20 });
  await wait(500);
  assert.strictEqual(idled, false);
  online = false;
  await wait(800);
  assert.strictEqual(idled, true);
  clearInterval(t);
});

test('a server that comes back resets the limit', async () => {
  let online = false;
  let idled = false;
  const t = autostart.watch({ pid: null, online: () => online, onIdle: () => { idled = true; }, limit: 600, every: 20 });
  await wait(300);
  online = true;
  await wait(100);
  online = false;
  await wait(300);
  assert.strictEqual(idled, false);
  clearInterval(t);
});

test('the first server process keeps the bot up until it is gone', async () => {
  const child = napping(1000);
  let idled = false;
  const t = autostart.watch({ pid: child.pid, online: () => false, onIdle: () => { idled = true; }, limit: 200, every: 20 });
  await wait(600);
  assert.strictEqual(idled, false);
  await new Promise((res) => child.on('exit', res));
  await wait(800);
  assert.strictEqual(idled, true);
  clearInterval(t);
});
