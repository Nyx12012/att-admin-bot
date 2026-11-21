const items = require('../core/items');
const { UserError } = require('../game/text');
const { link, row, lines, page } = require('./ui');

const T = { SUB: 1, GROUP: 2, STR: 3, INT: 4, BOOL: 5, NUM: 10 };
const DISCORD = new Set([6, 7, 8, 9, 11]);
const HIDDEN = new Set(['help', 'setup', 'permissions', 'controlpanel', 'despawnmenu', 'purge', 'say', 'embed', 'poll', 'cmd', 'string', 'l', 'link', 'boot', 'items', 'shop.menu', 'shop.buy', 'sell.item', 'report.ping']);
const REASONS = ['Breaking the rules', 'Griefing', 'Cheating', 'Spamming'];
const MESSAGES = ['Please follow the server rules.', 'An admin is on the way to you.', 'The server restarts soon.', 'Please stop that.'];
const NONE = '-';
const CATEGORIES = ['Ore', 'Wood', 'Food', 'Tools', 'Weapons', 'Armor', 'Potions', 'Misc'];

function kindOf(name, sub, o) {
  if (DISCORD.has(o.type)) return 'discord';
  if (o.choices && o.choices.length) return 'choice';
  if (o.type === T.BOOL) return 'bool';
  if (o.type === T.INT || o.type === T.NUM) return ['x', 'y', 'z'].includes(o.name) ? 'text' : 'number';
  if (o.name === 'player' || o.name === 'target' || (name === 'autobuff' && o.name === 'name')) return 'player';
  if (o.name === 'item' || o.name === 'item_code') return 'item';
  if (name === 'message' && o.name === 'text') return 'message';
  if (o.name === 'material') return 'material';
  if (o.name === 'chunk') return 'chunk';
  if (o.name === 'gamerole') return 'gamerole';
  if (name === 'shop' && o.name === 'category') return 'category';
  if (o.name === 'reason') return 'reason';
  if (name === 'plot' && sub === 'create' && o.name === 'name') return 'plotname';
  if (o.autocomplete) return 'auto';
  return 'text';
}

function presets(o) {
  let list;
  if (/hours/.test(o.name)) list = [1, 6, 24, 72, 168, 720];
  else if (/minutes/.test(o.name)) list = [1, 5, 10, 30, 60];
  else if (/seconds|warning/.test(o.name)) list = [10, 30, 60, 120, 300];
  else if (o.name === 'hour') list = [0, 6, 9, 12, 15, 18, 21];
  else if (o.type === T.NUM) list = [0, 0.5, 1, 1.5, 2, 5, 10, 100];
  else list = [1, 2, 5, 10, 25, 50, 100, 250, 1000];
  const min = o.min_value;
  const max = o.max_value;
  const ok = list.filter((v) => (min == null || v >= min) && (max == null || v <= max));
  return ok.length ? ok : [min ?? max ?? 1];
}

function leavesOf(registry) {
  const out = [];
  for (const [name, cmd] of registry.commands) {
    if (HIDDEN.has(name)) continue;
    const json = cmd.data.toJSON();
    const subs = (json.options || []).filter((o) => o.type === T.SUB);
    const list = subs.length ? subs : [{ name: null, description: json.description, options: json.options || [] }];
    for (const s of list) {
      const key = s.name ? `${name}.${s.name}` : name;
      if (HIDDEN.has(key)) continue;
      const options = (s.options || []).map((o) => ({ ...o, kind: kindOf(name, s.name, o) }));
      const fillable = options.every((o) => !o.required || (o.kind !== 'discord' && o.kind !== 'text'));
      out.push({ name, sub: s.name, key, title: `/${name}${s.name ? ` ${s.name}` : ''}`, description: s.description || '', options: options.filter((o) => o.kind !== 'discord' && o.kind !== 'text'), fillable });
    }
  }
  return out;
}

class Forms {
  constructor(tablet) {
    this.t = tablet;
    this.cache = null;
  }

  leaves() {
    if (!this.cache) this.cache = leavesOf(this.t.bot.registry);
    return this.cache;
  }

  leaf(name, sub) {
    const s = sub === NONE ? null : sub || null;
    return this.leaves().find((l) => l.name === name && l.sub === s) || null;
  }

  visible(env, area, leaf) {
    return leaf.fillable && this.t.may(env, area, leaf.name, leaf.sub);
  }

  values(leaf, q) {
    const out = {};
    for (const o of leaf.options) if (q[o.name] != null && q[o.name] !== '') out[o.name] = q[o.name];
    return out;
  }

  typed(leaf, q) {
    const out = {};
    for (const o of leaf.options) {
      const v = q[o.name];
      if (v == null || v === '') continue;
      if (o.kind === 'bool') out[o.name] = v === 'true';
      else if (o.type === T.INT || o.type === T.NUM) {
        const n = o.type === T.INT ? Number.parseInt(v, 10) : Number(v);
        if (!Number.isFinite(n)) throw new UserError(`${o.name} must be a number.`);
        if ((o.min_value != null && n < o.min_value) || (o.max_value != null && n > o.max_value)) throw new UserError(`${o.name} is out of range.`);
        out[o.name] = n;
      } else {
        if (o.kind === 'choice' && !o.choices.some((c) => String(c.value) === v)) throw new UserError(`${v} is not a choice for ${o.name}.`);
        out[o.name] = v;
      }
    }
    for (const o of leaf.options) if (o.required && out[o.name] == null) throw new UserError(`Pick ${o.name} first.`);
    return out;
  }

  show(o, v) {
    if (v == null || v === '') return null;
    if (o.kind === 'bool') return v === 'true' ? 'yes' : 'no';
    if (o.kind === 'item') {
      const it = items.byHash(v);
      return it ? it.name : v;
    }
    if (o.kind === 'choice') {
      const c = o.choices.find((x) => String(x.value) === v);
      return c ? c.name : v;
    }
    return v;
  }

  wizard(env, area, leaf, q) {
    if (!leaf || !this.visible(env, area, leaf)) throw new UserError('That command is not on the tablet for you.');
    const vals = this.values(leaf, q);
    const sub = leaf.sub || NONE;
    const missing = leaf.options.filter((o) => o.required && vals[o.name] == null);
    const rows = [];
    if (missing.length) rows.push({ k: '', t: 'Run', d: `pick ${missing.map((o) => o.name).join(' and ')} first`, m: 'x' });
    else rows.push(row(link(area, ['x', leaf.name, sub], vals), 'Run', leaf.options.filter((o) => vals[o.name] != null).map((o) => this.show(o, vals[o.name])).join(', '), { c: 1 }));
    const sorted = leaf.options.filter((o) => o.required).concat(leaf.options.filter((o) => !o.required));
    for (const o of sorted) {
      const shown = this.show(o, vals[o.name]);
      rows.push(row(link(area, ['p', leaf.name, sub, o.name], vals), `${o.name}: ${shown || (o.required ? 'pick' : 'not set')}`, o.description));
    }
    if (leaf.options.length === 0) rows.push(...lines(leaf.description));
    return page(leaf.title, rows, { status: leaf.options.length ? leaf.description : '', r: link(area, ['w', leaf.name, sub], vals) });
  }

  async picker(env, area, leaf, optName, q) {
    if (!leaf || !this.visible(env, area, leaf)) throw new UserError('That command is not on the tablet for you.');
    const o = leaf.options.find((x) => x.name === optName);
    if (!o) throw new UserError('That option is gone. Update the bot.');
    const vals = this.values(leaf, q);
    const sub = leaf.sub || NONE;
    const back = (v) => link(area, ['w', leaf.name, sub], { ...vals, [o.name]: v });
    const here = (extra) => link(area, ['p', leaf.name, sub, o.name], { ...vals, ...extra });
    const pick = (v, label, d) => row(back(v), label, d, { m: 'u' });
    const self = link(area, ['p', leaf.name, sub, o.name], { ...vals, _s: q._s, _l: q._l });
    let rows = [];
    let status = o.description;
    if (o.kind === 'item') {
      const got = await this.itemRows(env, leaf, q, (it) => pick(String(it.hash), it.name, String(it.hash)), here);
      rows = got.rows;
      status = got.status || status;
    } else if (o.kind === 'player') {
      rows.push(pick(env.player, `Me (${env.player})`));
      for (const p of this.t.online(env).filter((x) => x.toLowerCase() !== env.player.toLowerCase())) rows.push(pick(p, p));
    } else if (o.kind === 'choice') {
      rows = o.choices.map((c) => pick(String(c.value), c.name));
    } else if (o.kind === 'bool') {
      rows = [pick('true', 'Yes'), pick('false', 'No')];
    } else if (o.kind === 'number') {
      rows = presets(o).map((n) => pick(String(n), String(n)));
    } else if (o.kind === 'reason') {
      rows = REASONS.map((r) => pick(r, r));
    } else if (o.kind === 'message') {
      rows = MESSAGES.map((r) => pick(r, r));
    } else if (o.kind === 'chunk') {
      const plot = vals.plot ? this.t.bot.plots.doc(env.server)[String(vals.plot).toLowerCase()] : null;
      const mine = await this.t.chunkOf(env, env.player);
      if (mine) rows.push(pick(mine, `Where I stand (${mine})`));
      if (plot) for (const c of plot.chunks) if (c !== mine) rows.push(pick(c, c, `in ${plot.name}`));
    } else if (o.kind === 'category') {
      const used = Object.values(this.t.bot.economy.shop(env.server).items).map((x) => x.category).filter(Boolean);
      rows = [...new Set(used.concat(CATEGORIES))].map((c) => pick(c, c));
    } else if (o.kind === 'gamerole') {
      rows = (await this.t.gameRoles(env)).map((r) => pick(r, r));
      if (!rows.length) status = 'No game roles found. Give a player a role in the Server launcher first.';
    } else if (o.kind === 'plotname') {
      const owner = vals.player || env.player;
      const taken = this.t.bot.plots.doc(env.server);
      for (let i = 1; rows.length < 3 && i < 50; i += 1) {
        const name = (i === 1 ? owner : `${owner} ${i}`).toLowerCase().replace(/[^a-z0-9 _-]/g, '').trim();
        if (name && !taken[name]) rows.push(pick(name, name));
      }
    } else {
      const choices = await this.t.autoChoices(env, leaf, o, vals);
      rows = choices.map((c) => pick(c.value, c.name));
    }
    if (!o.required && vals[o.name] != null) {
      const rest = { ...vals };
      delete rest[o.name];
      rows.push(row(link(area, ['w', leaf.name, sub], rest), 'Clear', `leave ${o.name} unset`, { m: 'u' }));
    }
    if (rows.length === 0) rows.push(...lines('Nothing to pick from right now.'));
    return page(o.name, rows, { status, r: self });
  }

  async itemRows(env, leaf, q, pick, here) {
    const spawn = leaf.name === 'spawn';
    const pool = (list) => list.filter((it) => (spawn ? it.spawn : it.pickup));
    const src = q._s;
    if (src === 'hand') {
      const inv = await env.server.inventory(env.player).catch(() => null);
      const seen = new Set();
      const found = [];
      for (const e of inv ? [inv.LeftHand, inv.RightHand, ...(inv.Belt || [])] : []) {
        const it = e && items.byHash(e.PrefabHash);
        if (it && !seen.has(it.hash)) {
          seen.add(it.hash);
          found.push(it);
        }
      }
      return { rows: found.map(pick), status: found.length ? 'In your hands and on your belt' : 'Hold the item, then open this again.' };
    }
    if (src === 'shop' || src === 'sell') {
      const doc = src === 'shop' ? this.t.bot.economy.shop(env.server) : this.t.bot.economy.buyback(env.server);
      const seen = new Set();
      const found = [];
      for (const x of Object.values(doc.items)) {
        const it = x.hash != null && items.byHash(x.hash);
        if (it && !seen.has(it.hash)) {
          seen.add(it.hash);
          found.push(it);
        }
      }
      return { rows: pool(found).sort((a, b) => a.name.localeCompare(b.name)).map(pick) };
    }
    if (src === 'recent') return { rows: this.t.recent(env).map((h) => items.byHash(h)).filter(Boolean).map(pick) };
    if (src === 'az' && q._l) {
      const letter = String(q._l).slice(0, 1).toUpperCase();
      return { rows: pool(items.ITEMS).filter((it) => it.name.toUpperCase().startsWith(letter)).sort((a, b) => a.name.localeCompare(b.name)).map(pick), status: `Items starting with ${letter}` };
    }
    if (src === 'az') {
      const letters = [...new Set(pool(items.ITEMS).map((it) => it.name.charAt(0).toUpperCase()).filter((c) => /[A-Z]/.test(c)))].sort();
      const out = [];
      for (let i = 0; i < letters.length; i += 3) {
        const group = letters.slice(i, i + 3);
        for (const l of group) out.push(row(here({ _s: 'az', _l: l }), l, '', { m: 's' }));
      }
      return { rows: out, status: 'Pick the first letter' };
    }
    return {
      rows: [
        row(here({ _s: 'hand' }), 'In my hands', 'what you hold or wear on your belt', { m: 's' }),
        row(here({ _s: 'recent' }), 'Recent', 'items you picked here lately', { m: 's' }),
        row(here({ _s: 'shop' }), 'Shop items', 'what the shop sells', { m: 's' }),
        row(here({ _s: 'sell' }), 'Sell list items', 'what the bot buys', { m: 's' }),
        row(here({ _s: 'az' }), 'A to Z', 'every item by name', { m: 's' }),
      ],
      status: 'Where is the item?',
    };
  }
}

module.exports = { Forms, kindOf, presets, leavesOf, HIDDEN, NONE };
