const { chunkName, overworldChunk, UserError, isSafeName, safeKey, own, vec } = require('../game/text');

const DEFAULT_TREE_CHUNK = '17-34';
const TREE_COOLDOWN_MS = 15000;
const ADMIN_CACHE_MS = 300000;
const MAP_WIDTH = 40;
const MAP_HEIGHT = 24;
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

class Plots {
  constructor(bot) {
    this.bot = bot;
    this.cooldown = new Map();
    this.where = new Map();
    this.warned = new Set();
    this.timer = null;
    this.defaultTree = DEFAULT_TREE_CHUNK;
    this.treeCooldown = new Map();
    this.down = new Set();
    this.seenAs = new Map();
    this.adminCache = new Map();
    this.ticking = false;
  }

  doc(server) {
    return this.bot.store.get(`server-${server.id}-plots`, {});
  }

  settings(server) {
    const d = this.bot.store.get(`server-${server.id}-plotsettings`, () => ({}));
    if (d.enforce == null) d.enforce = true;
    if (d.adminPass == null) d.adminPass = true;
    if (d.leave == null) d.leave = false;
    if (!d.staff) d.staff = [];
    if (!d.prefer) d.prefer = {};
    if (d.tree === undefined) d.tree = { chunk: DEFAULT_TREE_CHUNK };
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
    const c = overworldChunk(chunk);
    if (!c) return null;
    return Object.values(this.doc(server)).find((p) => p.chunks.includes(c)) || null;
  }

  create(server, name, owner, chunk, spawn = null) {
    const key = safeKey(name);
    const d = this.doc(server);
    if (own(d, key)) throw new UserError(`A plot called "${key}" already exists.`);
    const c = chunkName(chunk);
    if (!/^\d+-\d+$/.test(c)) throw new UserError('Could not read a chunk for that spot.');
    const clash = this.at(server, c);
    if (clash) throw new UserError(`Chunk ${c} already belongs to the plot "${clash.name}".`);
    d[key] = { name: key, owner, chunks: [c], trusted: [], exit: { area: 'RespawnPoint' }, mode: 'eject', created: Date.now(), spawn: vec(spawn) };
    this.save(server);
    return d[key];
  }

  parseChunks(text) {
    const list = [...new Set(String(text).split(/[\s,;]+/).map((c) => chunkName(c)).filter(Boolean))];
    if (list.length === 0) throw new UserError('List at least one chunk, like 15-28,16-28.');
    for (const c of list) if (!/^\d+-\d+$/.test(c)) throw new UserError(`"${c}" is not a chunk. Write them like 15-28,16-28.`);
    return list;
  }

  claim(server, name, owner, text) {
    const key = safeKey(name);
    const d = this.doc(server);
    if (own(d, key)) throw new UserError(`A plot called "${key}" already exists.`);
    const list = this.parseChunks(text);
    for (const c of list) {
      const clash = this.at(server, c);
      if (clash) throw new UserError(`Chunk ${c} already belongs to the plot "${clash.name}".`);
    }
    d[key] = { name: key, owner, chunks: list, trusted: [], exit: { area: 'RespawnPoint' }, mode: 'eject', created: Date.now(), spawn: null };
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

  listed(server, plot, username) {
    const lower = username.toLowerCase();
    if (plot.owner.toLowerCase() === lower) return 'owner';
    if (plot.trusted.some((t) => t.toLowerCase() === lower)) return 'trusted';
    if (this.settings(server).staff.some((t) => t.toLowerCase() === lower)) return 'staff';
    return null;
  }

  allowed(server, plot, username) {
    return this.listed(server, plot, username) != null;
  }

  async isDiscordAdmin(server, username) {
    if (!server.guildId || !this.bot.links) return false;
    const discordId = this.bot.links.ownerOf(server, username);
    if (!discordId) return false;
    const key = `${server.guildId}:${discordId}`;
    const hit = this.adminCache.get(key);
    if (hit && hit.until > Date.now()) return hit.admin;
    const guilds = this.bot.client && this.bot.client.guilds;
    const guild = guilds && guilds.cache && guilds.cache.get(server.guildId);
    if (!guild) return false;
    const member = await guild.members.fetch(discordId).catch(() => null);
    const admin = Boolean(member) && this.bot.permissions.isAdmin(member, guild, discordId);
    this.adminCache.set(key, { admin, until: Date.now() + ADMIN_CACHE_MS });
    return admin;
  }

  async access(server, plot, username) {
    const listed = this.listed(server, plot, username);
    if (listed) return listed;
    if (this.settings(server).adminPass && (await this.isDiscordAdmin(server, username))) return 'admin';
    return null;
  }

  canManage(ctx, plot) {
    const link = this.bot.links.of(ctx.server, ctx.user.id);
    if (link && link.username.toLowerCase() === plot.owner.toLowerCase()) return true;
    return this.bot.permissions.allows(ctx.i, 'plot.admin', 'admin');
  }

  noteName(server, username, id) {
    if (id == null) return;
    const roster = server.players().find((p) => p.id === id);
    if (!roster || roster.username.toLowerCase() === username.toLowerCase()) return;
    const key = `${server.id}:${username.toLowerCase()}`;
    if (this.seenAs.get(key) === roster.username) return;
    this.seenAs.set(key, roster.username);
    this.bot.logs.line(server, 'plots', `**${username}** moved under that name, but the player list calls id ${id} **${roster.username}**. Plots go by the moved name.`);
  }

  async fillSpawn(server, username, current) {
    const plot = this.at(server, current);
    if (!plot || plot.spawn || plot.owner.toLowerCase() !== username.toLowerCase()) return;
    const { pos, chunk } = await server.position(username);
    if (!pos || overworldChunk(chunk) !== current) return;
    plot.spawn = pos;
    this.save(server);
  }

  plotFor(server, username) {
    const lower = username.toLowerCase();
    const all = Object.values(this.doc(server));
    const wish = own(this.settings(server).prefer, lower);
    const chosen = wish ? own(this.doc(server), wish) : null;
    if (chosen && this.allowed(server, chosen, username)) return chosen;
    return all.find((p) => p.owner.toLowerCase() === lower) || all.find((p) => p.trusted.some((t) => t.toLowerCase() === lower)) || null;
  }

  async sendToPlot(server, username, plot) {
    const key = `${server.id}:${username.toLowerCase()}`;
    if (this.down.has(key) || (this.treeCooldown.get(key) || 0) > Date.now()) return false;
    this.treeCooldown.set(key, Date.now() + TREE_COOLDOWN_MS);
    if (!plot.spawn) {
      await server.message(username, `Your plot "${plot.name}" has no arrival spot yet. Walk into it once, then come back.`, 8).catch(() => {});
      return false;
    }
    try {
      await server.teleportToPoint(username, plot.spawn);
    } catch (e) {
      console.warn(`[plots] could not send ${username} to ${plot.name}: ${e.message}`);
      return false;
    }
    const mine = plot.owner.toLowerCase() === username.toLowerCase();
    await server.message(username, mine ? `Welcome to your plot "${plot.name}".` : `Welcome to ${plot.owner}'s plot "${plot.name}".`, 6).catch(() => {});
    this.bot.logs.line(server, 'plots', `**${username}** took the plot tree to **${plot.name}**.`);
    return true;
  }

  async treeCheck(server, username, current, moved) {
    const tree = this.settings(server).tree;
    if (!moved || !tree || current !== tree.chunk) return;
    const plot = this.plotFor(server, username);
    if (plot) await this.sendToPlot(server, username, plot);
  }

  async moveOut(server, username, plot) {
    if (plot.exit.point) await server.teleportToPoint(username, plot.exit.point);
    else await server.teleportToArea(username, plot.exit.area || 'RespawnPoint');
  }

  async check(server, username, chunk, { old = null, id = null, moved = false } = {}) {
    if (!isSafeName(username)) {
      if (!this.warned.has(username)) {
        this.warned.add(username);
        this.bot.logs.line(server, 'plots', `The name of a player cannot be sent to the console, so plots cannot move them: ${JSON.stringify(String(username).slice(0, 40))}.`);
      }
      return;
    }
    const key = `${server.id}:${username.toLowerCase()}`;
    const current = overworldChunk(chunk);
    this.where.set(key, current || chunkName(chunk));
    this.noteName(server, username, id);
    if (current) {
      await this.fillSpawn(server, username, current).catch(() => {});
      await this.treeCheck(server, username, current, moved).catch((e) => console.warn(`[plots] ${e.message}`));
    }
    const settings = this.settings(server);
    if (!settings.enforce) return;
    const plot = current ? this.at(server, current) : null;
    const left = moved && old ? this.at(server, old) : null;
    if (settings.leave && left && left !== plot) {
      const how = await this.access(server, left, username);
      if ((how === 'owner' || how === 'trusted') && !(plot && this.allowed(server, plot, username)) && (this.cooldown.get(key) || 0) <= Date.now()) {
        this.cooldown.set(key, Date.now() + 8000);
        await this.moveOut(server, username, left).catch((e) => console.warn(`[plots] could not move ${username} out of ${left.name}: ${e.message}`));
        await server.message(username, `You left the plot "${left.name}".`, 6).catch(() => {});
        return;
      }
    }
    if (!plot || plot.mode === 'off' || (await this.access(server, plot, username))) return;
    if ((this.cooldown.get(key) || 0) > Date.now()) return;
    this.cooldown.set(key, Date.now() + 8000);
    await server.message(username, `This is ${plot.owner}'s plot "${plot.name}". You do not have access. You show as ${username}.`, 6).catch(() => {});
    if (plot.mode === 'eject') {
      try {
        await this.moveOut(server, username, plot);
      } catch (e) {
        console.warn(`[plots] could not move ${username} out of ${plot.name}: ${e.message}`);
      }
    }
    this.bot.logs.line(server, 'plots', `**${username}** entered the plot **${plot.name}** (${plot.owner}) and was ${plot.mode === 'eject' ? 'sent out' : 'warned'}.`);
  }

  async why(server, username) {
    const { chunk } = await server.position(username);
    const current = overworldChunk(chunk);
    const plot = current ? this.at(server, current) : null;
    const settings = this.settings(server);
    const lines = [
      `Name the bot uses: **${username}**`,
      `Chunk: **${chunk || 'unknown'}**${current ? '' : ' (inside a building or cave, plots do not apply)'}`,
      `Plot protection: ${settings.enforce ? 'on' : 'off'}`,
    ];
    const other = this.seenAs.get(`${server.id}:${username.toLowerCase()}`);
    if (other) lines.push(`Warning: the move events call this player **${username}**, the player list calls them **${other}**.`);
    if (!plot) {
      lines.push('Not inside any plot, so nothing happens here.');
    } else {
      const how = await this.access(server, plot, username);
      lines.push(`Plot: **${plot.name}**, owner **${plot.owner}**, intruders ${plot.mode === 'eject' ? 'sent out' : plot.mode === 'warn' ? 'warned' : 'ignored'}`);
      lines.push(`Trusted: ${plot.trusted.join(', ') || 'nobody'}`);
      lines.push(`Staff: ${settings.staff.join(', ') || 'nobody'}`);
      lines.push(how ? `Result: **allowed** (${how}).` : '**Result: not allowed.** The name above matches no owner, trusted or staff entry. Every entry must be the exact in-game name.');
    }
    const home = this.plotFor(server, username);
    lines.push(home ? `The plot tree sends them to **${home.name}**${home.spawn ? '' : ', which has no arrival spot yet'}.` : 'The plot tree ignores them, they are on no plot.');
    return lines.join('\n');
  }

  map(server) {
    const plots = Object.values(this.doc(server));
    const cells = new Map();
    plots.forEach((p, i) => {
      for (const c of p.chunks) cells.set(c, LETTERS[i % LETTERS.length]);
    });
    if (cells.size === 0) return null;
    const pts = [...cells.keys()].map((c) => c.split('-').map(Number));
    const minX = Math.min(...pts.map((p) => p[0]));
    const minZ = Math.min(...pts.map((p) => p[1]));
    const maxX = Math.min(Math.max(...pts.map((p) => p[0])), minX + MAP_WIDTH - 1);
    const maxZ = Math.min(Math.max(...pts.map((p) => p[1])), minZ + MAP_HEIGHT - 1);
    const rows = [];
    for (let z = maxZ; z >= minZ; z -= 1) {
      let row = `${String(z).padStart(3)} `;
      for (let x = minX; x <= maxX; x += 1) row += cells.get(`${x}-${z}`) || '.';
      rows.push(row);
    }
    const head = `x ${minX} to ${maxX}, z on the left`;
    const legend = plots.map((p, i) => `${LETTERS[i % LETTERS.length]} = ${p.name} (${p.owner})`);
    return `\`\`\`\n${head}\n${rows.join('\n')}\n\`\`\`\n${legend.join('\n')}`;
  }

  async sweep(server) {
    if (!server.online || server.roster.size === 0 || (Object.keys(this.doc(server)).length === 0)) return;
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
        if (name && d.newChunk) this.check(server, name, d.newChunk, { old: d.oldChunk, id: d.player.id, moved: true }).catch(() => {});
      });
      server.on('PlayerStateChanged', (d) => {
        const name = d.user && d.user.username;
        if (!name || (d.state !== 'Downed' && d.state !== 'Dead')) return;
        const key = `${server.id}:${String(name).toLowerCase()}`;
        if (d.isEnter) this.down.add(key);
        else this.down.delete(key);
      });
      server.on('PlayerLeft', (d) => {
        const name = d.user && d.user.username;
        if (!name) return;
        const key = `${server.id}:${String(name).toLowerCase()}`;
        this.down.delete(key);
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
