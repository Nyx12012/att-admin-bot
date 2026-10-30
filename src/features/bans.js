const { cleanText, isSafeName, own, RESERVED, UserError } = require('../game/text');
const { embed } = require('../core/ui');

class Bans {
  constructor(bot) {
    this.bot = bot;
    this.timer = null;
    this.recent = new Map();
  }

  doc(server) {
    return this.bot.store.get(`server-${server.id}-bans`, {});
  }

  list(server) {
    this.expire(server);
    return Object.values(this.doc(server)).sort((a, b) => a.username.localeCompare(b.username));
  }

  get(server, username) {
    const b = own(this.doc(server), String(username).toLowerCase());
    if (!b) return null;
    if (b.until && b.until < Date.now()) return null;
    return b;
  }

  add(server, username, { hours = 0, reason = '', by = '' } = {}) {
    if (RESERVED.has(String(username).toLowerCase())) throw new UserError(`"${username}" cannot be stored as a name.`);
    const entry = {
      username,
      reason: cleanText(reason, 150) || 'Banned',
      by,
      at: Date.now(),
      until: hours > 0 ? Date.now() + hours * 3600000 : null,
    };
    this.bot.store.update(`server-${server.id}-bans`, {}, (d) => { d[username.toLowerCase()] = entry; });
    return entry;
  }

  remove(server, username) {
    return this.bot.store.update(`server-${server.id}-bans`, {}, (d) => {
      const k = String(username).toLowerCase();
      const had = own(d, k);
      if (had) delete d[k];
      return had || null;
    });
  }

  expire(server) {
    const gone = [];
    this.bot.store.update(`server-${server.id}-bans`, {}, (d) => {
      for (const [k, b] of Object.entries(d)) {
        if (b.until && b.until < Date.now()) {
          gone.push(b);
          delete d[k];
        }
      }
    });
    for (const b of gone) this.bot.logs.line(server, 'bans', `Ban on **${b.username}** ran out.`);
    return gone;
  }

  async enforce(server, username, { quiet = false } = {}) {
    const ban = this.get(server, username);
    if (!ban || !isSafeName(username)) return false;
    const key = `${server.id}:${username.toLowerCase()}`;
    if ((this.recent.get(key) || 0) > Date.now()) return 'kicked';
    this.recent.set(key, Date.now() + 3000);
    const reason = ban.until ? `Banned until ${new Date(ban.until).toUTCString()}: ${ban.reason}` : `Banned: ${ban.reason}`;
    try {
      await server.run(`player kick "${username}" "${cleanText(reason, 180)}"`);
    } catch (e) {
      this.recent.delete(key);
      console.warn(`[${server.id}] could not kick banned ${username}: ${e.message}`);
      this.bot.logs.line(server, 'bans', `Could not kick banned player **${username}**: ${e.message}`);
      return 'failed';
    }
    if (!quiet) this.bot.logs.line(server, 'bans', `Kicked banned player **${username}** on join.`);
    return 'kicked';
  }

  start() {
    for (const server of this.bot.servers.values()) {
      server.on('PlayerJoined', (data) => {
        const name = data.user && data.user.username;
        if (name) setTimeout(() => this.enforce(server, name), 4000);
      });
      server.on('ready', () => {
        for (const p of server.players()) this.enforce(server, p.username);
      });
      server.on('rosterJoin', (p) => this.enforce(server, p.username));
    }
    this.timer = setInterval(() => {
      for (const server of this.bot.servers.values()) this.expire(server);
    }, 60000);
    this.timer.unref?.();
  }

  stop() {
    clearInterval(this.timer);
  }

  card(ban) {
    return embed('warn', `Banned: ${ban.username}`, null, [
      ['Reason', ban.reason, false],
      ['Until', ban.until ? `<t:${Math.floor(ban.until / 1000)}:f>` : 'Permanent', true],
      ['By', ban.by || 'unknown', true],
    ]);
  }
}

module.exports = Bans;
