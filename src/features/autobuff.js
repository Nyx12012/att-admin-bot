const { isSafeName, own } = require('../game/text');

const JOIN_DELAY_MS = 30000;

class Autobuff {
  constructor(bot) {
    this.bot = bot;
    this.recent = new Map();
    this.timers = new Set();
  }

  doc(server) {
    return this.bot.store.get(`server-${server.id}-autobuff`, {});
  }

  save(server) {
    this.bot.store.save(`server-${server.id}-autobuff`);
  }

  async apply(server, name) {
    const key = own(this.doc(server), name.toLowerCase());
    if (!key) return false;
    const buff = own(this.bot.store.get(`server-${server.id}-buffs`, {}), key);
    if (!buff) return false;
    for (const [stat, value] of Object.entries(buff.stats)) {
      const cur = await server.stat(name, stat).catch(() => null);
      if (!cur) continue;
      await server.setStat(name, cur.name, Math.max(cur.min, Math.min(cur.max, value))).catch(() => {});
    }
    return true;
  }

  joined(server, name) {
    if (!name || !isSafeName(name) || !own(this.doc(server), name.toLowerCase())) return;
    const key = `${server.id}:${name.toLowerCase()}`;
    if ((this.recent.get(key) || 0) > Date.now()) return;
    this.recent.set(key, Date.now() + 2 * JOIN_DELAY_MS);
    const t = setTimeout(() => {
      this.timers.delete(t);
      this.apply(server, name).catch((e) => console.warn(`[autobuff] ${name}: ${e.message}`));
    }, JOIN_DELAY_MS);
    t.unref?.();
    this.timers.add(t);
  }

  start() {
    for (const server of this.bot.servers.values()) {
      server.on('PlayerJoined', (d) => this.joined(server, d.user && d.user.username));
      server.on('rosterJoin', (p) => this.joined(server, p.username));
    }
  }

  stop() {
    for (const t of this.timers) clearTimeout(t);
  }
}

module.exports = Autobuff;
