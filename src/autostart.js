const fs = require('fs');
const path = require('path');
const util = require('util');

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

function lock(dataDir) {
  const file = path.join(dataDir, 'bot.pid');
  try {
    const old = Number(fs.readFileSync(file, 'utf8').trim());
    const fresh = Date.now() - fs.statSync(file).mtimeMs < 90000;
    if (fresh && old !== process.pid && alive(old)) return { ok: false, pid: old };
  } catch {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  fs.writeFileSync(file, String(process.pid));
  const beat = setInterval(() => {
    try {
      const now = new Date();
      fs.utimesSync(file, now, now);
    } catch {
      clearInterval(beat);
    }
  }, 30000);
  beat.unref();
  const release = () => {
    try {
      if (Number(fs.readFileSync(file, 'utf8').trim()) === process.pid) fs.unlinkSync(file);
    } catch {
      clearInterval(beat);
    }
  };
  process.on('exit', release);
  return { ok: true, file, release };
}

function watch(pid, onGone, every = 5000) {
  const t = setInterval(() => {
    if (alive(pid)) return;
    clearInterval(t);
    onGone();
  }, every);
  return t;
}

module.exports = { serverPid, alive, logToFile, lock, watch };
