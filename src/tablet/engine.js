const { TabletContext, plain } = require('../core/tabletctx');
const { allowed, levelOf } = require('../core/registry');
const { LEVELS } = require('../core/permissions');
const auto = require('../core/autocomplete');
const items = require('../core/items');
const { UserError, isSafeName, prefabName } = require('../game/text');
const { parse, row, page } = require('./ui');
const { Forms } = require('./forms');
const pages = require('./pages');

const AREAS = ['shop', 'sell', 'me', 'plots', 'actions', 'players', 'spawn', 'cleanup', 'server', 'commands'];
const LABELS = {
  shop: ['Shop', 'buy things, sent to your mailbox'],
  sell: ['Sell', 'sell what you carry to the bot'],
  me: ['Me', 'coins, withdraw, link Discord'],
  plots: ['Plots', 'your plots'],
  actions: ['Actions', 'things your role can do'],
  players: ['Players', 'bring, heal, kick, ban and more'],
  spawn: ['Spawn', 'items for you or a player'],
  cleanup: ['Cleanup', 'clear items near you and more'],
  server: ['Server', 'time, save, restart'],
  commands: ['Commands', 'every bot command'],
};
const LIFT = {
  players: { level: 'admin', keys: ['kick', 'ban.add', 'tp.summon', 'tp.goto', 'heal', 'kill', 'godmode', 'player.info', 'player.inventory', 'player.stats'] },
  spawn: { level: 'owner', keys: ['spawn', 'mail', 'kit.give'] },
  cleanup: { level: 'admin', keys: ['cleanup.run', 'cleanup.preview', 'cleanup.sweep', 'cleanup.list', 'despawn'] },
  server: { level: 'admin', keys: ['time.day', 'time.night', 'time.set', 'save.now', 'save.backup', 'restart', 'shutdown', 'festival.list', 'festival.start', 'festival.stop', 'status', 'players', 'announce.list', 'settings.show'] },
  plots: { level: 'admin', staff: true, keys: ['plot.claim', 'plot.spawn', 'plot.grow', 'plot.shrink', 'plot.delete', 'plot.mode', 'plot.teleport', 'plot.trust', 'plot.untrust', 'plot.info', 'plot.where', 'plot.list'] },
};
const NOT_SELF = new Set(['kick', 'ban.add', 'tp.summon', 'tp.goto']);
const MAX_BYTES = 850;
const PICKUP_MS = 5 * 60000;

function int(v, min, max, fallback) {
  const n = Number(v);
  if (!Number.isInteger(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function str(v, max = 80) {
  return String(v == null ? '' : v).slice(0, max);
}

function cut(s, max) {
  const t = String(s == null ? '' : s);
  return t.length > max ? `${t.slice(0, max - 1)}.` : t;
}

function atLeast(text, major, minor) {
  const m = String(text || '').match(/^BotCore (\d+)\.(\d+)/);
  return Boolean(m) && (Number(m[1]) > major || (Number(m[1]) === major && Number(m[2]) >= minor));
}

function top(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return LEVELS[a] >= LEVELS[b] ? a : b;
}

function slim(r) {
  return {
    k: str(r.k, 400),
    t: cut(plain(r.t), 40),
    ...(r.d ? { d: cut(plain(r.d), 44) } : {}),
    ...(r.m ? { m: r.m } : {}),
    ...(r.c ? { c: 1 } : {}),
    ...(r.w ? { w: 1 } : {}),
  };
}

function fit(reply) {
  const out = { ...reply };
  if (out.rows) out.rows = out.rows.map(slim);
  if (out.title) out.title = cut(plain(out.title), 40);
  if (out.status) out.status = cut(plain(out.status), 60);
  if (out.text) out.text = plain(out.text);
  for (const k of ['status', 'text', 'r']) if (!out[k]) delete out[k];
  const size = () => Buffer.byteLength(JSON.stringify(out), 'utf8');
  while (size() > MAX_BYTES && out.text && out.text.length > 20) out.text = cut(out.text, Math.floor(out.text.length * 0.8));
  while (size() > MAX_BYTES && out.rows && out.rows.some((r) => r.d)) {
    const last = [...out.rows].reverse().find((r) => r.d);
    delete last.d;
  }
  while (size() > MAX_BYTES && out.rows && out.rows.length > 1) out.rows = out.rows.slice(0, -1);
  return JSON.stringify(out);
}

class Tablet {
  constructor(bot) {
    this.bot = bot;
    this.forms = new Forms(this);
    this.sessions = new Map();
    this.recents = new Map();
    this.frozen = new Map();
    this.used = new Map();
    this.waits = new Map();
  }

  start() {
    for (const server of this.bot.servers.values()) {
      server.on('BotCoreTablet', (data) => this.ask(server, data).catch((e) => server.log('warn', `a tablet request failed: ${e.message}`)));
      server.on('ready', () => {
        this.hello(server).catch(() => {});
        this.watch(server);
      });
      server.on('InventoryChanged', (d) => this.picked(server, d));
    }
  }

  stop() {
    for (const t of this.waits.values()) clearTimeout(t);
    this.waits.clear();
  }

  discordReady() {
    for (const server of this.bot.servers.values()) if (server.online) this.hello(server).catch(() => {});
  }

  name() {
    const u = this.bot.client && this.bot.client.user;
    return cut((u && (u.globalName || u.username)) || 'Bot', 32);
  }

  async hello(server) {
    if (!atLeast(server.botcore, 1, 5)) return;
    const name = Buffer.from(this.name(), 'utf8').toString('base64');
    await server.run(`botcore tablet hello "${name}"`, { allowError: true, timeout: 10000 });
  }

  async ask(server, data) {
    const id = Number(data && data.id);
    if (!Number.isInteger(id) || id < 0) return;
    let reply;
    try {
      reply = await this.handle(server, data);
    } catch (e) {
      const known = e instanceof UserError;
      if (!known) console.error('[tablet]', e);
      reply = { ok: false, title: 'Could not do that', text: known ? plain(e.message) : 'Something went wrong in the bot. The full error is in the bot window.' };
    }
    const json = fit(reply);
    await server.run(`botcore tablet answer ${id} "${Buffer.from(json, 'utf8').toString('base64')}"`, { allowError: true, timeout: 10000 });
  }

  async handle(server, data) {
    const player = str(data.player, 64);
    if (!isSafeName(player)) throw new UserError('Your name cannot be sent to the console.');
    const allowedPages = (Array.isArray(data.pages) ? data.pages : []).map((p) => String(p).toLowerCase()).filter((p) => AREAS.includes(p));
    const roles = (Array.isArray(data.roles) ? data.roles : []).map((r) => str(r, 40).toLowerCase()).slice(0, 32);
    let ask;
    try {
      ask = JSON.parse(String(data.ask || '{}'));
    } catch {
      throw new UserError('The request could not be read.');
    }
    if (ask == null || typeof ask !== 'object' || typeof ask.go !== 'string') throw new UserError('This bot needs BotCore.Server and BotCore.Client 1.6 or newer. Ask the server owner to update them.');
    const route = parse(ask.go);
    if (route.area !== 'home' && !allowedPages.includes(route.area)) throw new UserError('Your role cannot use that page on this server.');
    const env = await this.env(server, player, allowedPages, roles, int(ask.at, 0, 100000, 0), int(ask.n, 1, 8, 3));
    return this.shape(env, await this.route(env, route));
  }

  async env(server, player, allowedPages, roles, at, n) {
    const discordId = this.bot.links.ownerOf(server, player);
    const found = discordId ? await this.bot.memberOf(server, discordId) : null;
    const member = found ? found.member : null;
    const guild = found ? found.guild : null;
    let level = roles.includes('owner') ? 'owner' : roles.includes('admin') ? 'admin' : null;
    if (discordId && this.bot.permissions.isOwner(member, guild, discordId)) level = 'owner';
    else if (member && this.bot.permissions.isAdmin(member, guild, discordId)) level = top(level, 'admin');
    const staff = allowedPages.includes('players') || level === 'admin' || level === 'owner';
    return { server, player, pages: allowedPages, roles, discordId, member, guild, level, staff, at, n };
  }

  shape(env, p) {
    if (p.r) {
      const all = p.rows || [];
      const at = all.length ? Math.min(env.at, Math.max(0, all.length - 1)) : 0;
      return { ok: true, title: p.title, status: p.status, rows: all.slice(at, at + env.n), total: all.length, at, r: p.r };
    }
    return { ok: p.ok !== false, title: p.title, status: p.status, rows: p.rows || [], text: p.text || '' };
  }

  async route(env, r) {
    if (r.area === 'home') return this.home(env);
    const [verb, ...rest] = r.path;
    if (verb === 'w' || verb === 'p' || verb === 'x') return this.form(env, r.area, verb, rest, r.q);
    return pages[r.area](this, env, verb || '', r.q);
  }

  home(env) {
    const rows = [];
    for (const a of AREAS) {
      if (!env.pages.includes(a)) continue;
      if (a === 'actions' && this.actionsFor(env).length === 0) continue;
      const [label, detail] = LABELS[a];
      rows.push(row(a, label, a === 'plots' && env.staff ? 'list, create, edit, delete' : detail));
    }
    return page(`${this.name()} Menu`, rows, { r: 'home', status: rows.length ? '' : 'Nothing here for you yet.' });
  }

  async form(env, area, verb, rest, q) {
    const [name, sub, opt] = rest;
    const leaf = this.forms.leaf(name, sub);
    if (verb === 'w') return this.forms.wizard(env, area, leaf, q);
    if (verb === 'p') return this.forms.picker(env, area, leaf, opt, q);
    if (!leaf || !this.forms.visible(env, area, leaf)) throw new UserError('That command is not on the tablet for you.');
    const values = this.forms.typed(leaf, q);
    if (NOT_SELF.has(leaf.key)) {
      const who = values.player || values.target;
      if (who && who.toLowerCase() === env.player.toLowerCase()) throw new UserError('Pick someone else.');
    }
    if (values.item) this.remember(env, values.item);
    return this.run(env, area, leaf.name, leaf.sub, values);
  }

  lift(env, area, key) {
    const l = LIFT[area];
    if (!l || !l.keys.includes(key) || (l.staff && !env.staff)) return null;
    return l.level;
  }

  context(env, area, cmd, sub, values, confirmer = null) {
    const key = sub ? `${cmd.data.name}.${sub}` : cmd.data.name;
    const level = top(env.level, this.lift(env, area, key));
    return new TabletContext(this.bot, env.server, env.player, cmd, sub || null, values, confirmer, { discordId: env.discordId, member: env.member, guild: env.guild, level, roles: env.roles });
  }

  may(env, area, name, sub) {
    const cmd = this.bot.registry.commands.get(name);
    if (!cmd) return false;
    const ctx = this.context(env, area, cmd, sub, {});
    return allowed(this.bot, ctx.i, cmd, ctx);
  }

  async run(env, area, name, sub, values, { confirmer = null, audit = null } = {}) {
    const cmd = this.bot.registry.commands.get(name);
    if (!cmd) throw new UserError(`This bot has no /${name} command.`);
    const ctx = this.context(env, area, cmd, sub, values, confirmer || (async () => true));
    const label = [name, sub].filter(Boolean).join(' ');
    if (!allowed(this.bot, ctx.i, cmd, ctx)) throw new UserError(`You cannot use /${label} on the tablet.`);
    const write = audit ?? levelOf(cmd, ctx) !== 'everyone';
    const entry = {
      guildId: env.server.guildId,
      userId: env.discordId,
      userTag: `${env.player} (in game)`,
      command: `${label} (tablet)`,
      args: Object.entries(values).filter(([, v]) => v != null).map(([k, v]) => `${k}:${v}`).join(' '),
    };
    if (env.server.online && Date.now() - (env.server.rosterAt || 0) > 15000) await env.server.refreshRoster().catch(() => {});
    try {
      await cmd.run(ctx);
    } catch (e) {
      if (write) this.bot.audit.write({ ...entry, outcome: e instanceof UserError ? 'refused' : 'error', detail: e.message });
      throw e;
    }
    if (write) this.bot.audit.write({ ...entry, outcome: ctx.cancelled ? 'cancelled' : 'ok', detail: ctx.notes.join('\n') });
    const out = ctx.out || { title: 'Done', text: '' };
    return { ok: ctx.kind !== 'fail', title: out.title, text: out.text, rows: [], cancelled: Boolean(ctx.cancelled) };
  }

  note(env, command, args, outcome, detail = '') {
    this.bot.audit.write({ guildId: env.server.guildId, userId: env.discordId, userTag: `${env.player} (in game)`, command: `${command} (tablet)`, args, outcome, detail });
  }

  online(env) {
    return env.server.players().map((p) => p.username).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  }

  async gameRoles(env) {
    const found = new Set((env.roles || []).filter((r) => r && r !== 'everyone'));
    for (const key of Object.keys(this.bot.economy.rates(env.server))) if (key.startsWith('g:')) found.add(key.slice(2).split('|')[0]);
    for (const a of Object.values(this.actions(env.server))) for (const r of a.gameRoles || []) if (r !== 'everyone') found.add(r);
    for (const name of this.online(env).slice(0, 10)) for (const r of await this.bot.economy.gameRoles(env.server, name)) found.add(r);
    return [...found].sort();
  }

  async chunkOf(env, name) {
    const p = await env.server.position(name).catch(() => null);
    return p && /^\d+-\d+$/.test(p.chunk || '') ? p.chunk : null;
  }

  async autoChoices(env, leaf, o, vals) {
    const cmd = this.bot.registry.commands.get(leaf.name);
    const ctx = this.context(env, 'commands', cmd, leaf.sub, vals);
    const focused = { name: o.name, value: '' };
    let list = [];
    try {
      if (cmd.autocomplete) list = (await cmd.autocomplete(ctx, focused)) || [];
      if (!list.length) list = (await auto.generic(ctx, focused)) || [];
    } catch {
      list = [];
    }
    return list.slice(0, 60).map((c) => (typeof c === 'string' ? { name: c, value: c } : { name: String(c.name), value: String(c.value) }));
  }

  remember(env, hash) {
    const key = `${env.server.id}:${env.player.toLowerCase()}`;
    const list = (this.recents.get(key) || []).filter((h) => h !== String(hash));
    list.unshift(String(hash));
    this.recents.set(key, list.slice(0, 9));
  }

  recent(env) {
    return this.recents.get(`${env.server.id}:${env.player.toLowerCase()}`) || [];
  }

  actions(server) {
    return this.bot.store.get(`server-${server.id}-actions`, {});
  }

  actionsFor(env) {
    const kits = this.bot.store.get(`server-${env.server.id}-cc`, {});
    const roles = env.member && env.member.roles && env.member.roles.cache ? new Set(env.member.roles.cache.keys()) : new Set();
    return Object.entries(this.actions(env.server))
      .filter(([key, a]) => kits[key] && (a.gameRoles.includes('everyone') || a.gameRoles.some((r) => env.roles.includes(r)) || a.roles.some((r) => roles.has(r))))
      .map(([key, a]) => ({ key, ...a }));
  }

  sessionKey(server, name) {
    return `${server.id}:${String(name).toLowerCase()}`;
  }

  session(server, name) {
    const key = this.sessionKey(server, name);
    const s = this.sessions.get(key);
    if (s && s.until < Date.now()) {
      this.sessions.delete(key);
      this.watch(server);
      return null;
    }
    return s || null;
  }

  setSession(server, name, value) {
    const key = this.sessionKey(server, name);
    if (value) this.sessions.set(key, { ...value, until: Date.now() + PICKUP_MS });
    else this.sessions.delete(key);
    this.watch(server);
  }

  watch(server) {
    const any = [...this.sessions.keys()].some((k) => k.startsWith(`${server.id}:`));
    server.want('InventoryChanged', 'tablet', any);
  }

  picked(server, d) {
    const user = d && (d.User || d.user);
    const name = user && user.username;
    const change = d && d.ChangeType;
    if (!name || !(change === 0 || /^pick/i.test(String(change)))) return;
    const s = this.session(server, name);
    if (!s) return;
    const key = this.sessionKey(server, name);
    clearTimeout(this.waits.get(key));
    const t = setTimeout(() => {
      this.waits.delete(key);
      this.onPickup(server, name, prefabName(d.ItemName || '')).catch((e) => server.log('warn', `pickup check for ${name} failed: ${e.message}`));
    }, 250);
    if (t.unref) t.unref();
    this.waits.set(key, t);
  }

  async onPickup(server, name, itemName) {
    const s = this.session(server, name);
    if (!s || !server.online) return;
    const inv = await server.inventory(name).catch(() => null);
    const hands = inv ? [inv.LeftHand, inv.RightHand].filter((e) => e && e.Identifier != null) : [];
    const want = itemName.toLowerCase();
    const hit = hands.find((e) => prefabName(e.Name || '').toLowerCase() === want) || (hands.length === 1 ? hands[0] : null);
    if (!hit) return;
    const label = prefabName(hit.Name || itemName) || 'that item';
    const it = items.byHash(hit.PrefabHash);
    if (s.mode === 'info') {
      await server.message(name, `${label}: code ${hit.PrefabHash}${it && it.material ? ', takes a material' : ''}`, 6).catch(() => {});
      return;
    }
    const gone = await server.destroyEntity(Number(hit.Identifier));
    if (!gone) return;
    s.left -= 1;
    this.bot.audit.write({ guildId: server.guildId, userId: null, userTag: `${name} (in game)`, command: 'destroy on pickup (tablet)', args: `${label} ${hit.Identifier}`, outcome: 'ok', detail: '' });
    if (s.left <= 0) {
      this.setSession(server, name, null);
      await server.message(name, `Destroyed ${label}. Destroy on pickup is off.`, 5).catch(() => {});
    } else {
      await server.message(name, `Destroyed ${label}. ${s.left} more.`, 4).catch(() => {});
    }
  }
}

module.exports = Tablet;
module.exports.fit = fit;
module.exports.atLeast = atLeast;
module.exports.AREAS = AREAS;
