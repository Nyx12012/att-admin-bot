const { TabletContext, plain } = require('../core/tabletctx');
const { UserError, isSafeName, own } = require('../game/text');

const PAGES = ['plots', 'shop', 'sell', 'admin'];
const ROWS = 6;
const MAX_BYTES = 850;

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

function byName(a, b) {
  return a.localeCompare(b, undefined, { sensitivity: 'base' });
}

function atLeast(text, major, minor) {
  const m = String(text || '').match(/^BotCore (\d+)\.(\d+)/);
  return Boolean(m) && (Number(m[1]) > major || (Number(m[1]) === major && Number(m[2]) >= minor));
}

function fit(reply) {
  const out = { ...reply };
  if (out.rows) out.rows = out.rows.map((r) => ({ k: str(r.k, 80), t: cut(plain(r.t), 40), d: cut(plain(r.d), 44), ...(Number.isFinite(r.p) ? { p: r.p } : {}) }));
  if (out.title) out.title = cut(out.title, 40);
  if (out.status) out.status = cut(out.status, 60);
  let json = JSON.stringify(out);
  while (Buffer.byteLength(json, 'utf8') > MAX_BYTES && out.text && out.text.length > 20) {
    out.text = cut(out.text, Math.floor(out.text.length * 0.8));
    json = JSON.stringify(out);
  }
  while (Buffer.byteLength(json, 'utf8') > MAX_BYTES && out.rows && out.rows.length > 1) {
    out.rows = out.rows.slice(0, -1);
    json = JSON.stringify(out);
  }
  return json;
}

class Tablet {
  constructor(bot) {
    this.bot = bot;
  }

  start() {
    for (const server of this.bot.servers.values()) {
      server.on('BotCoreTablet', (data) => this.ask(server, data).catch((e) => server.log('warn', `a tablet request failed: ${e.message}`)));
      server.on('ready', () => this.hello(server).catch(() => {}));
    }
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
    const pages = Array.isArray(data.pages) ? data.pages.map((p) => String(p)) : [];
    let ask;
    try {
      ask = JSON.parse(String(data.ask || '{}'));
    } catch {
      throw new UserError('The request could not be read.');
    }
    const page = str(ask.page, 16);
    const act = str(ask.act, 16);
    const args = ask.args && typeof ask.args === 'object' ? ask.args : {};
    if (!PAGES.includes(page) || !pages.includes(page)) throw new UserError('Your role cannot use that page on this server.');
    const at = int(args.at, 0, 100000, 0);
    const n = int(args.n, 1, ROWS, ROWS);
    const other = () => {
      const who = str(args.player, 64);
      if (!who) throw new UserError('Pick a player.');
      if (who.toLowerCase() === player.toLowerCase()) throw new UserError('Pick someone else.');
      return who;
    };
    switch (`${page}.${act}`) {
      case 'shop.list': return this.shopList(server, player, at, n);
      case 'shop.buy': return this.buy(server, player, args);
      case 'sell.list': return this.sellList(server, at, n);
      case 'sell.sell': return this.sell(server, player, args);
      case 'plots.list': return this.plotList(server, at, n);
      case 'plots.info': return this.run(server, player, 'plot', 'info', { plot: str(args.name, 32) });
      case 'plots.go': return this.run(server, player, 'plot', 'teleport', { plot: str(args.name, 32), player }, { audit: true });
      case 'admin.players': return this.players(server, player, at, n);
      case 'admin.kick': return this.run(server, player, 'kick', null, { player: other() }, { audit: true });
      case 'admin.bring': return this.run(server, player, 'tp', 'summon', { player: other() }, { audit: true });
      case 'admin.goto': return this.run(server, player, 'tp', 'goto', { target: other() }, { audit: true });
      case 'admin.ban': return this.run(server, player, 'ban', 'add', { player: other(), hours: int(args.hours, 0, 87600, 0) || null, reason: `Banned in game by ${player}` }, { audit: true });
      default: throw new UserError('The bot does not know that button. Update the bot.');
    }
  }

  async run(server, player, name, sub, values, { audit = false, confirmer = null } = {}) {
    const cmd = this.bot.registry.commands.get(name);
    if (!cmd) throw new UserError(`This bot has no /${name} command.`);
    const ctx = new TabletContext(this.bot, server, player, cmd, sub, values, confirmer);
    const entry = {
      guildId: server.guildId,
      userId: null,
      userTag: `${player} (in game)`,
      command: `${[name, sub].filter(Boolean).join(' ')} (tablet)`,
      args: Object.entries(values).filter(([, v]) => v != null).map(([k, v]) => `${k}:${v}`).join(' '),
    };
    if (server.online && Date.now() - (server.rosterAt || 0) > 15000) await server.refreshRoster().catch(() => {});
    try {
      await cmd.run(ctx);
    } catch (e) {
      if (audit) this.bot.audit.write({ ...entry, outcome: e instanceof UserError ? 'refused' : 'error', detail: e.message });
      throw e;
    }
    if (audit) this.bot.audit.write({ ...entry, outcome: ctx.cancelled ? 'cancelled' : 'ok', detail: ctx.notes.join('\n') });
    const out = ctx.out || { title: 'Done', text: '' };
    return { ok: ctx.kind !== 'fail', title: out.title, text: out.text, cancelled: Boolean(ctx.cancelled) };
  }

  async shopList(server, player, at, n) {
    const doc = this.bot.economy.shop(server);
    const all = Object.entries(doc.items)
      .filter(([, x]) => !x.role)
      .sort(([, a], [, b]) => byName(a.category || '', b.category || '') || byName(a.name, b.name));
    const rows = all.slice(at, at + n).map(([k, x]) => ({ k, t: x.name, d: `${x.price} coins${x.daily ? `, ${x.daily} a day` : ''}`, p: x.price }));
    let status = all.length ? '' : 'Nothing for sale yet.';
    if (all.length && server.botcore) {
      try {
        const user = await server.lookup(player);
        status = `You have ${await this.bot.economy.coins(server, user)} coins`;
      } catch {
        status = '';
      }
    }
    return { ok: true, rows, total: all.length, at, status };
  }

  async buy(server, player, args) {
    const doc = this.bot.economy.shop(server);
    const key = str(args.key);
    const x = own(doc.items, key.toLowerCase()) || own(doc.items, key);
    if (!x) throw new UserError('That is not for sale any more.');
    if (x.role) throw new UserError('Discord roles are bought on Discord with /shop.');
    return this.run(server, player, 'shop', 'buy', { product: key, amount: int(args.amount, 1, 25, 1) });
  }

  async sellList(server, at, n) {
    const doc = this.bot.economy.buyback(server);
    const entries = Object.entries(doc.items).sort(([, a], [, b]) => byName(a.name, b.name));
    const groups = new Map();
    for (const [, x] of entries) if (x.material && !own(doc.items, String(x.hash)) && !groups.has(x.hash)) groups.set(x.hash, x.base || x.name);
    const all = [...groups].map(([hash, base]) => ({ k: `all:${hash}`, t: base, d: 'any kind, priced by what you carry' }))
      .concat(entries.map(([k, x]) => ({ k, t: x.name, d: `${x.price} coins each${x.daily ? `, ${x.daily} a day` : ''}` })));
    const status = doc.paused ? 'Buying is paused right now.' : all.length ? 'Tap one to see the offer.' : 'The bot buys nothing yet.';
    return { ok: true, rows: all.slice(at, at + n), total: all.length, at, status };
  }

  async sell(server, player, args) {
    const values = { goods: str(args.key) };
    if (args.phase === 'do') {
      const quote = String(args.quote || '');
      let fresh = null;
      const r = await this.run(server, player, 'sell', 'item', values, {
        confirmer: async (title, text) => {
          if (text === quote) return true;
          fresh = { title, text };
          return false;
        },
      });
      if (fresh) return { ok: true, quote: true, title: 'The offer changed', text: fresh.text };
      return r;
    }
    let quoted = null;
    const r = await this.run(server, player, 'sell', 'item', values, {
      confirmer: async (title, text) => {
        quoted = { title, text };
        return false;
      },
    });
    if (quoted) return { ok: true, quote: true, title: quoted.title, text: quoted.text };
    return r;
  }

  async plotList(server, at, n) {
    const list = Object.values(this.bot.plots.doc(server)).sort((a, b) => byName(a.name, b.name));
    const rows = list.slice(at, at + n).map((p) => ({ k: p.name, t: p.name, d: `${p.owner}, ${p.chunks.length} chunk${p.chunks.length === 1 ? '' : 's'}` }));
    return { ok: true, rows, total: list.length, at, status: list.length ? '' : 'No plots yet.' };
  }

  async players(server, player, at, n) {
    if (server.online && Date.now() - (server.rosterAt || 0) > 15000) await server.refreshRoster().catch(() => {});
    const list = server.players().filter((p) => p.username.toLowerCase() !== player.toLowerCase()).sort((a, b) => byName(a.username, b.username));
    const rows = list.slice(at, at + n).map((p) => ({ k: p.username, t: p.username, d: '' }));
    return { ok: true, rows, total: list.length, at, status: list.length ? '' : 'Nobody else is online.' };
  }
}

module.exports = Tablet;
module.exports.fit = fit;
module.exports.atLeast = atLeast;
