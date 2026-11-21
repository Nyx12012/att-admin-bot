const crypto = require('crypto');
const { UserError } = require('../game/text');

class Links {
  constructor(bot) {
    this.bot = bot;
    this.pending = new Map();
    this.starts = new Map();
    this.fails = new Map();
    this.codes = new Map();
  }

  fromGame(server, username) {
    const taken = this.ownerOf(server, username);
    if (taken) throw new UserError('You are already linked to a Discord account. An admin can remove it with /link remove.');
    const key = `g:${server.id}:${username.toLowerCase()}`;
    if (this.recent(this.starts, key, 60000).length >= 1) throw new UserError('Wait a minute before asking for another code.');
    this.recent(this.starts, key, 60000).push(Date.now());
    for (const [code, p] of this.codes) if (p.server === server.id && p.username.toLowerCase() === username.toLowerCase()) this.codes.delete(code);
    let code;
    do code = String(crypto.randomInt(100000, 1000000)); while (this.codes.has(code));
    this.codes.set(code, { server: server.id, username, until: Date.now() + 5 * 60000 });
    return code;
  }

  doc(server) {
    return this.bot.store.get(`server-${server.id}-links`, {});
  }

  of(server, discordId) {
    if (!server) return null;
    return this.doc(server)[discordId] || null;
  }

  ownerOf(server, username) {
    const lower = String(username).toLowerCase();
    for (const [discordId, link] of Object.entries(this.doc(server))) {
      if (link.username.toLowerCase() === lower) return discordId;
    }
    return null;
  }

  recent(map, key, windowMs) {
    const now = Date.now();
    const list = (map.get(key) || []).filter((t) => now - t < windowMs);
    map.set(key, list);
    return list;
  }

  async begin(server, discordId, username) {
    const player = server.requireOnline(username);
    const taken = this.ownerOf(server, player.username);
    if (taken && taken !== discordId) throw new UserError(`${player.username} is already linked to another Discord account. An admin can remove it with /link remove.`);
    const target = `p:${server.id}:${player.username.toLowerCase()}`;
    const mine = this.recent(this.starts, `u:${server.id}:${discordId}`, 60000);
    if (mine.length >= 1) throw new UserError('Wait a minute before asking for another code.');
    if (this.recent(this.fails, target, 3600000).length >= 6) throw new UserError(`Too many wrong codes for ${player.username}. Try again in an hour.`);
    const forTarget = this.recent(this.starts, target, 600000);
    if (forTarget.length >= 3) throw new UserError(`${player.username} got 3 codes in the last 10 minutes. Try again later.`);
    mine.push(Date.now());
    forTarget.push(Date.now());
    const code = String(crypto.randomInt(1000, 10000));
    this.pending.set(`${server.id}:${discordId}`, { username: player.username, id: player.id, code, until: Date.now() + 5 * 60000, tries: 0 });
    await server.message(player.username, `Discord link code: ${code}. Type /link confirm ${code} in Discord. Ignore this if you did not ask for it.`, 20);
    return player.username;
  }

  confirm(server, discordId, code) {
    const key = `${server.id}:${discordId}`;
    const p = this.pending.get(key);
    const typed = String(code).trim();
    if ((!p || p.until < Date.now()) && /^\d{6}$/.test(typed)) return this.confirmGame(server, discordId, typed);
    if (!p || p.until < Date.now()) {
      this.pending.delete(key);
      throw new UserError('No link code is waiting for you. Start again with /link start.');
    }
    p.tries += 1;
    if (String(code).trim() !== p.code) {
      this.recent(this.fails, `p:${server.id}:${p.username.toLowerCase()}`, 3600000).push(Date.now());
      if (p.tries >= 3) this.pending.delete(key);
      throw new UserError(p.tries >= 3 ? 'Wrong code three times. Start again with /link start.' : 'That code is wrong. Check the message in game.');
    }
    this.pending.delete(key);
    this.bot.store.update(`server-${server.id}-links`, {}, (d) => {
      for (const [k, v] of Object.entries(d)) if (v.username.toLowerCase() === p.username.toLowerCase()) delete d[k];
      d[discordId] = { username: p.username, id: p.id, at: Date.now() };
    });
    return p.username;
  }

  confirmGame(server, discordId, code) {
    const mine = this.recent(this.fails, `d:${server.id}:${discordId}`, 600000);
    if (mine.length >= 5) throw new UserError('Too many wrong codes. Try again in 10 minutes.');
    const g = this.codes.get(code);
    if (!g || g.server !== server.id || g.until < Date.now()) {
      if (g && g.until < Date.now()) this.codes.delete(code);
      mine.push(Date.now());
      throw new UserError('That code is wrong or too old. Open Me on the bot tablet in game for a new one.');
    }
    this.codes.delete(code);
    const taken = this.ownerOf(server, g.username);
    if (taken && taken !== discordId) throw new UserError(`${g.username} is already linked to another Discord account.`);
    this.bot.store.update(`server-${server.id}-links`, {}, (d) => {
      for (const [k, v] of Object.entries(d)) if (v.username.toLowerCase() === g.username.toLowerCase()) delete d[k];
      d[discordId] = { username: g.username, id: null, at: Date.now() };
    });
    return g.username;
  }

  remove(server, discordId) {
    return this.bot.store.update(`server-${server.id}-links`, {}, (d) => {
      const had = Boolean(d[discordId]);
      delete d[discordId];
      return had;
    });
  }

  removeName(server, username) {
    const owner = this.ownerOf(server, username);
    if (!owner) return null;
    this.remove(server, owner);
    return owner;
  }
}

module.exports = Links;
