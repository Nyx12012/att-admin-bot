const { chunkName, UserError, isSafeName, safeKey, own } = require('../game/text');

class Plots {
  constructor(bot) {
    this.bot = bot;
    this.cooldown = new Map();
    this.where = new Map();
    this.warned = new Set();
    this.timer = null;
  }

  doc(server) {
    return this.bot.store.get(`server-${server.id}-plots`, {});
  }

  settings(server) {
    const d = this.bot.store.get(`server-${server.id}-plotsettings`, () => ({}));
    if (d.enforce == null) d.enforce = true;
    if (!d.staff) d.staff = [];
    return d;
  }

  saveSettings(server) {
    this.bot.store.save(`server-${server.id}-plotsettings`);
  }

  save(server) {
    this.bot.store.save(`server-${server.id}-plots`);
  }

  get(server, name) {
    const p = own(this.doc(server), String(name).toLowerCase());
    if (!p) throw new UserError(`There is no plot called "${name}".`);
    return p;
  }

  at(server, chunk) {
    const c = chunkName(chunk);
    return Object.values(this.doc(server)).find((p) => p.chunks.includes(c)) || null;
  }

  create(server, name, owner, chunk) {
    const key = safeKey(name);
    const d = this.doc(server);
    if (own(d, key)) throw new UserError(`A plot called "${key}" already exists.`);
    const c = chunkName(chunk);
    if (!/^\d+-\d+$/.test(c)) throw new UserError('Could not read a chunk for that spot.');
    const clash = this.at(server, c);
    if (clash) throw new UserError(`Chunk ${c} already belongs to the plot "${clash.name}".`);
    d[key] = { name: key, owner, chunks: [c], trusted: [], exit: { area: 'RespawnPoint' }, mode: 'eject', created: Date.now() };
    this.save(server);
    return d[key];
  }

  addChunk(server, plot, chunk) {
    const c = chunkName(chunk);
    if (!/^\d+-\d+$/.test(c)) throw new UserError('Could not read the chunk that player is in.');
    const clash = this.at(server, c);
    if (clash && clash !== plot) throw new UserError(`Chunk ${c} already belongs to the plot "${clash.name}".`);
    if (!plot.chunks.includes(c)) plot.chunks.push(c);
    this.save(server);
    return c;
  }

  allowed(server, plot, username) {
    const lower = username.toLowerCase();
    if (plot.owner.toLowerCase() === lower) return true;
    if (plot.trusted.some((t) => t.toLowerCase() === lower)) return true;
    return this.settings(server).staff.some((t) => t.toLowerCase() === lower);
  }

  canManage(ctx, plot) {
    const link = this.bot.links.of(ctx.server, ctx.user.id);
    if (link && link.username.toLowerCase() === plot.owner.toLowerCase()) return true;
    return this.bot.permissions.allows(ctx.i, 'plot.admin', 'admin');
  }

  async check(server, username, chunk) {
    if (!isSafeName(username)) {
      if (!this.warned.has(username)) {
        this.warned.add(username);
        this.bot.logs.line(server, 'plots', `The name of a player cannot be sent to the console, so plots cannot move them: ${JSON.stringify(String(username).slice(0, 40))}.`);
      }
      return;
    }
    this.where.set(`${server.id}:${username.toLowerCase()}`, chunkName(chunk));
    if (!this.settings(server).enforce) return;
    const plot = this.at(server, chunk);
    if (!plot || plot.mode === 'off' || this.allowed(server, plot, username)) return;
    const key = `${server.id}:${username.toLowerCase()}`;
    if ((this.cooldown.get(key) || 0) > Date.now()) return;
    this.cooldown.set(key, Date.now() + 8000);
    await server.message(username, `This is ${plot.owner}'s plot "${plot.name}". You do not have access.`, 6).catch(() => {});
    if (plot.mode === 'eject') {
      try {
        if (plot.exit.point) await server.teleportToPoint(username, plot.exit.point);
        else await server.teleportToArea(username, plot.exit.area || 'RespawnPoint');
      } catch (e) {
        console.warn(`[plots] could not move ${username} out of ${plot.name}: ${e.message}`);
      }
    }
    this.bot.logs.line(server, 'plots', `**${username}** entered the plot **${plot.name}** (${plot.owner}) and was ${plot.mode === 'eject' ? 'sent out' : 'warned'}.`);
  }

  async sweep(server) {
    if (!server.online || server.roster.size === 0 || Object.keys(this.doc(server)).length === 0) return;
    const list = await server.value('player list-detailed').catch(() => null);
    if (!Array.isArray(list)) return;
    for (const p of list) {
      if (p && p.username && p.Chunk) await this.check(server, p.username, p.Chunk);
    }
  }

  start() {
    for (const server of this.bot.servers.values()) {
      server.on('PlayerMovedChunk', (d) => {
        const name = d.player && d.player.username;
        if (name && d.newChunk) this.check(server, name, d.newChunk).catch(() => {});
      });
    }
    this.timer = setInterval(() => {
      for (const server of this.bot.servers.values()) this.sweep(server).catch(() => {});
    }, 60000);
    this.timer.unref?.();
  }

  stop() {
    clearInterval(this.timer);
  }
}

module.exports = Plots;
