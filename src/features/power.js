const fs = require('fs');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const { alive } = require('../autostart');
const { UserError, quoteText } = require('../game/text');

const HOLD_MS = 5 * 60 * 1000;
const EXIT_MS = 90000;
const FORCE_MS = 15000;
const NO_WAY = 'The bot does not know how to start this server yet. Start it once by hand with BotCore 1.3.0 installed and the bot on the same PC, or set SERVER_START in .env.';

class Power {
  constructor(bot) {
    this.bot = bot;
    this.starting = new Map();
    this.busy = new Set();
    this.pollMs = 1000;
  }

  start() {
    for (const server of this.bot.servers.values()) {
      server.on('ready', () => {
        this.starting.delete(server.id);
        this.remember(server).catch(() => {});
      });
    }
  }

  key(server) {
    return `server-${server.id}-boot`;
  }

  async remember(server) {
    const file = String(await server.value('botcore startfile', { timeout: 10000 }).catch(() => 'none'));
    if (file === 'none' || !fs.existsSync(file)) return;
    this.bot.store.update(this.key(server), {}, (d) => {
      d.file = file;
    });
  }

  recorded(server) {
    const { file } = this.bot.store.get(this.key(server), {});
    if (!file) return null;
    let lines;
    try {
      lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    } catch {
      return null;
    }
    const [pid, exe, cwd, ...args] = lines;
    if (!exe || !fs.existsSync(exe)) return null;
    return { pid: Number(pid) || null, exe, cwd: cwd || path.dirname(exe), args: args.filter((a) => a !== '') };
  }

  custom(text) {
    const whole = text.trim().replace(/^"(.*)"$/, '$1');
    if (fs.existsSync(whole)) return { command: `"${whole}"`, cwd: path.dirname(whole) };
    return { command: text.trim(), cwd: this.bot.config.root || process.cwd() };
  }

  plan(server) {
    const record = this.recorded(server);
    if (server.config.start) return { ...this.custom(server.config.start), pid: record ? record.pid : null };
    return record;
  }

  canBoot(server) {
    return Boolean(this.plan(server));
  }

  needPlan(server) {
    const plan = this.plan(server);
    if (!plan) throw new UserError(NO_WAY);
    return plan;
  }

  launch(plan) {
    return new Promise((resolve, reject) => {
      const child = plan.command
        ? spawn(plan.command, [], { shell: true, cwd: plan.cwd, detached: true, stdio: 'ignore', windowsHide: true })
        : spawn(plan.exe, plan.args, { cwd: plan.cwd, detached: true, stdio: 'ignore' });
      child.once('error', reject);
      child.once('spawn', () => {
        child.unref();
        resolve();
      });
    });
  }

  portOpen(server) {
    return new Promise((resolve) => {
      const socket = net.connect({ host: server.config.host, port: server.config.port });
      const done = (open) => {
        socket.destroy();
        resolve(open);
      };
      socket.setTimeout(1500, () => done(false));
      socket.once('connect', () => done(true));
      socket.once('error', () => done(false));
    });
  }

  alive(pid) {
    return alive(pid);
  }

  async gone(server, pid, ms) {
    const end = Date.now() + ms;
    for (;;) {
      if (!(pid ? this.alive(pid) : await this.portOpen(server))) return true;
      if (Date.now() >= end) return false;
      await new Promise((r) => setTimeout(r, this.pollMs));
    }
  }

  async guarded(server, work) {
    if (this.busy.has(server.id)) throw new UserError(`${server.name} is being closed or restarted right now.`);
    this.busy.add(server.id);
    try {
      return await work();
    } finally {
      this.busy.delete(server.id);
    }
  }

  async run(server, plan) {
    try {
      await this.launch(plan);
    } catch (e) {
      throw new UserError(`The server could not be started: ${e.message}`);
    }
    this.starting.set(server.id, Date.now());
  }

  async boot(server) {
    return this.guarded(server, async () => {
      if (server.online) throw new UserError(`${server.name} is already running.`);
      const plan = this.needPlan(server);
      const since = this.starting.get(server.id);
      if (since && Date.now() - since < HOLD_MS) throw new UserError(`${server.name} was started a moment ago. Loading the world takes a few minutes.`);
      if (await this.portOpen(server)) throw new UserError(`The console of ${server.name} already answers, so a server is starting or stuck on this PC. Give it a few minutes, or close it by hand.`);
      await this.run(server, plan);
    });
  }

  async close(server, { seconds = 0, reason = null, what }) {
    if (seconds > 0 && server.players().length) {
      const text = `Server ${what} in ${seconds} seconds${reason ? `: ${reason}` : ''}`;
      await server.run(`player message * ${quoteText(text, 150)} ${Math.min(seconds, 60)}`, { allowError: true });
      await new Promise((r) => setTimeout(r, seconds * 1000));
    }
    const saved = await server.run('save now', { allowError: true, timeout: 120000 });
    if (saved.error) throw new UserError(`The world did not save, so the server stays up. ${saved.error}`);
    await server.run('quit', { allowError: true, timeout: 8000 }).catch(() => {});
  }

  async shutdown(server, options) {
    return this.guarded(server, () => this.close(server, { ...options, what: 'closes' }));
  }

  async restart(server, options) {
    const plan = this.needPlan(server);
    return this.guarded(server, async () => {
      await this.close(server, { ...options, what: 'restarts' });
      let forced = false;
      if (!(await this.gone(server, plan.pid, EXIT_MS))) {
        forced = true;
        if (plan.pid) {
          try {
            process.kill(plan.pid);
          } catch {
            forced = false;
          }
        }
        if (!(await this.gone(server, plan.pid, FORCE_MS))) throw new UserError(`${server.name} saved but the game did not close, so it was not started again. Close it by hand, then use /boot.`);
      }
      await this.run(server, plan);
      return { forced };
    });
  }
}

module.exports = Power;
