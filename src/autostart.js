const fs = require('fs');
const os = require('os');
const path = require('path');
const util = require('util');
const crypto = require('crypto');

const FRESH_MS = 90000;
const BEAT_MS = 30000;
const IDLE_MS = 600000;

function serverPid(argv = process.argv, env = process.env) {
  const i = argv.indexOf('--server-pid');
  const n = Number(i >= 0 ? argv[i + 1] : env.ATT_SERVER_PID);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

function logToFile(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try {
    if (fs.statSync(file).size > 5 * 1024 * 1024) fs.renameSync(file, `${file}.old`);
  } catch {}
  const write = (level, args) => {
    try {
      fs.appendFileSync(file, `${new Date().toISOString()} ${level} ${util.format(...args)}\n`);
    } catch {}
  };
  console.log = (...a) => write('info', a);
  console.info = (...a) => write('info', a);
  console.warn = (...a) => write('warn', a);
  console.error = (...a) => write('error', a);
}

function sharedDir() {
  return path.join(process.env.ProgramData || os.tmpdir(), 'ATT-Admin-Bot');
}

function tokenFile(token, dir = sharedDir()) {
  const id = crypto.createHash('sha256').update(String(token)).digest('hex').slice(0, 16);
  return path.join(dir, `${id}.pid`);
}

function holder(file) {
  try {
    const pid = Number(fs.readFileSync(file, 'utf8').trim());
    const age = Date.now() - fs.statSync(file).mtimeMs;
    if (age >= FRESH_MS) return null;
    if (!Number.isInteger(pid) || pid <= 0) return age < 5000 ? 0 : null;
    return pid !== process.pid && alive(pid) ? pid : null;
  } catch {
    return null;
  }
}

function claim(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  for (let i = 0; i < 2; i += 1) {
    try {
      fs.writeFileSync(file, String(process.pid), { flag: 'wx' });
      return null;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
    }
    const pid = holder(file);
    if (pid !== null) return pid;
    fs.rmSync(file, { force: true });
  }
  return 0;
}

function beat(file, lost) {
  try {
    const owner = Number(fs.readFileSync(file, 'utf8').trim());
    if (owner > 0 && owner !== process.pid && alive(owner)) {
      lost(owner);
      return;
    }
    if (owner !== process.pid) fs.writeFileSync(file, String(process.pid));
    const now = new Date();
    fs.utimesSync(file, now, now);
  } catch (e) {
    if (e.code !== 'ENOENT') return;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, String(process.pid));
    } catch {}
  }
}

function drop(files) {
  for (const file of files) {
    try {
      if (Number(fs.readFileSync(file, 'utf8').trim()) === process.pid) fs.unlinkSync(file);
    } catch {}
  }
}

function lock(dataDir, options = {}) {
  const files = [];
  if (options.token) {
    const shared = tokenFile(options.token, options.shared);
    try {
      const pid = claim(shared);
      if (pid !== null) return { ok: false, pid };
      files.push(shared);
    } catch (e) {
      console.warn(`Could not write ${shared} (${e.message}), so a copy in another folder would not be noticed.`);
    }
  }
  const file = path.join(dataDir, 'bot.pid');
  const pid = claim(file);
  if (pid !== null) {
    drop(files);
    return { ok: false, pid };
  }
  files.push(file);
  const lost = options.onLost || (() => {});
  const timer = setInterval(() => {
    for (const f of files) beat(f, lost);
  }, BEAT_MS);
  timer.unref();
  const release = () => {
    clearInterval(timer);
    drop(files);
  };
  process.on('exit', release);
  return { ok: true, file, files, release };
}

function watch({ pid, online, onIdle, limit = IDLE_MS, every = 5000 }) {
  let server = pid;
  let last = Date.now();
  const t = setInterval(() => {
    if (server && !alive(server)) server = null;
    if (server || online()) {
      last = Date.now();
      return;
    }
    if (Date.now() - last < limit) return;
    clearInterval(t);
    onIdle();
  }, every);
  t.unref?.();
  return t;
}

module.exports = { serverPid, alive, logToFile, sharedDir, tokenFile, beat, lock, watch };
