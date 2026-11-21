const crypto = require('crypto');
const { UserError, own, quoteName, isSafeName } = require('../game/text');
const { link, row, lines, page } = require('./ui');
const { NONE } = require('./forms');

const BUY = [1, 5, 10];
const WITHDRAW = [10, 50, 100, 500, 1000, 5000];
const RADII = [5, 10, 20, 30, 50];
const GROUPS = require('../commands/help').GROUPS || [];

function byName(a, b) {
  return a.localeCompare(b, undefined, { sensitivity: 'base' });
}

function digest(text) {
  return crypto.createHash('sha1').update(String(text)).digest('hex').slice(0, 12);
}

function atLeast(text, major, minor) {
  const m = String(text || '').match(/^BotCore (\d+)\.(\d+)/);
  return Boolean(m) && (Number(m[1]) > major || (Number(m[1]) === major && Number(m[2]) >= minor));
}

function rateCtx(env) {
  return { server: env.server, i: { member: env.member }, gameRoles: env.roles };
}

async function coins(t, env) {
  if (!env.server.botcore) return null;
  try {
    const user = await env.server.lookup(env.player);
    return await t.bot.economy.coins(env.server, user);
  } catch {
    return null;
  }
}

function result(r, title) {
  return { ok: r.ok, title: r.title || title, text: r.text, rows: [] };
}

async function shop(t, env, verb, q) {
  const eco = t.bot.economy;
  const doc = eco.shop(env.server);
  const rate = await eco.rateOf(rateCtx(env), env.player);
  const off = rate.buyBy && rate.buy !== 100 ? `${rate.buyBy} price, ${rate.buy}%` : '';
  if (verb === 'i' || verb === 'b') {
    const x = own(doc.items, String(q.k || '').toLowerCase());
    if (!x || x.role) throw new UserError('That is not for sale any more.');
    const unit = eco.buyUnit(x, rate);
    if (verb === 'b') {
      const amount = Math.min(25, Math.max(1, Number.parseInt(q.a, 10) || 1));
      return result(await t.run(env, 'shop', 'shop', 'buy', { product: x.key, amount }), 'Bought');
    }
    const rows = BUY.map((n) => row(link('shop', ['b'], { k: x.key, a: n }), `Buy ${n}`, `${n * unit} coins, sent to your mailbox`, { c: 1 }));
    if (x.daily) rows.push(...lines(`At most ${x.daily} a day.`));
    if (off) rows.push(...lines(off));
    return page(x.name, rows, { status: `${unit} coins each. Tap twice to buy.`, r: link('shop', ['i'], { k: x.key }) });
  }
  const all = Object.values(doc.items).filter((x) => !x.role).sort((a, b) => byName(a.category || '', b.category || '') || byName(a.name, b.name));
  const rows = all.map((x) => row(link('shop', ['i'], { k: x.key }), x.name, `${eco.buyUnit(x, rate)} coins${x.daily ? `, ${x.daily} a day` : ''}`));
  const have = all.length ? await coins(t, env) : null;
  const status = !all.length ? 'Nothing for sale yet.' : have != null ? `You have ${have} coins${off ? `, ${off}` : ''}` : off;
  return page('Shop', rows, { status, r: 'shop' });
}

async function sell(t, env, verb, q) {
  const eco = t.bot.economy;
  if (verb === 'q' || verb === 'd') {
    const key = String(q.k || '');
    let shown = null;
    const r = await t.run(env, 'sell', 'sell', 'item', { goods: key }, {
      confirmer: async (title, text) => {
        if (verb === 'd' && digest(text) === q.h) return true;
        shown = { title, text };
        return false;
      },
    });
    if (shown) {
      return {
        ok: true,
        title: verb === 'd' ? 'The offer changed' : shown.title,
        rows: [row(link('sell', ['d'], { k: key, h: digest(shown.text) }), 'Sell', 'the items are gone once you tap', { m: 's' })],
        text: shown.text,
      };
    }
    return result(r, 'Sold');
  }
  const doc = eco.buyback(env.server);
  const rate = await eco.rateOf(rateCtx(env), env.player);
  const entries = Object.entries(doc.items).sort(([, a], [, b]) => byName(a.name, b.name));
  const groups = new Map();
  for (const [, x] of entries) if (x.material && !own(doc.items, String(x.hash)) && !groups.has(x.hash)) groups.set(x.hash, x.base || x.name);
  const rows = [...groups].map(([hash, base]) => row(link('sell', ['q'], { k: `all:${hash}` }), base, 'any kind, priced by what you carry'))
    .concat(entries.map(([k, x]) => row(link('sell', ['q'], { k }), x.name, `${eco.sellUnit(env.server, x, rate)} coins each${x.daily ? `, ${x.daily} a day` : ''}`)));
  const bonus = rate.sellBy && rate.sell !== 100 ? ` ${rate.sellBy} price, ${rate.sell}%.` : '';
  const status = doc.paused ? 'Buying is paused right now.' : rows.length ? `Tap one to see the offer.${bonus}` : 'The bot buys nothing yet.';
  return page('Sell', rows, { status, r: 'sell' });
}

async function me(t, env, verb, q) {
  if (verb === 'cash') {
    const have = await coins(t, env);
    if (have == null) throw new UserError('Coins need BotCore on the server.');
    const amount = Number.parseInt(q.a, 10);
    if (Number.isInteger(amount)) return result(await t.run(env, 'me', 'withdraw', null, { amount }), 'Withdrawn');
    const rows = WITHDRAW.filter((n) => n < have).map((n) => row(link('me', ['cash'], { a: n }), `${n} coins`, 'a coin pouch in your mailbox', { c: 1 }));
    if (have > 0) rows.push(row(link('me', ['cash'], { a: have }), `All ${have} coins`, 'a coin pouch in your mailbox', { c: 1 }));
    return page('Withdraw', rows.length ? rows : lines('You have no coins.'), { status: `You have ${have} coins`, r: 'me/cash' });
  }
  if (verb === 'l') {
    const code = t.bot.links.fromGame(env.server, env.player);
    return { ok: true, title: 'Link Discord', rows: [], text: `Your code is ${code}. In Discord, type /link confirm ${code} within 5 minutes.` };
  }
  if (verb === 's') return result(await t.run(env, 'me', 'stats', 'player', { player: env.player }), 'Your stats');
  if (verb === 'where') {
    const p = await env.server.position(env.player).catch(() => null);
    const plot = p && p.chunk ? t.bot.plots.at(env.server, p.chunk) : null;
    return { ok: true, title: 'Where am I', rows: [], text: p && p.chunk ? `Chunk ${p.chunk}. ${plot ? `This is the plot ${plot.name} of ${plot.owner}.` : 'No plot here.'}` : 'Could not read where you are.' };
  }
  const have = await coins(t, env);
  const rows = [];
  if (have != null) rows.push(row('me/cash', 'Withdraw coins', 'get a coin pouch in your mailbox'));
  if (env.discordId) rows.push(...lines('Your account is linked to Discord.'));
  else rows.push(row('me/l', 'Link Discord', 'get a code for /link confirm'));
  rows.push(row('me/s', 'My stats', 'playtime and more'));
  rows.push(row('me/where', 'Where am I', 'chunk and plot'));
  return page('Me', rows, { status: have != null ? `You have ${have} coins` : '', r: 'me' });
}

function canManage(t, env, p) {
  return env.staff || p.owner.toLowerCase() === env.player.toLowerCase();
}

async function plots(t, env, verb, q) {
  const pl = t.bot.plots;
  const s = env.server;
  const name = String(q.p || '').toLowerCase();
  const get = () => {
    const p = own(pl.doc(s), name);
    if (!p) throw new UserError(`There is no plot called "${q.p}".`);
    return p;
  };
  const staffOnly = () => {
    if (!env.staff) throw new UserError('Only staff can do that.');
  };
  const go = (sub, values) => t.run(env, 'plots', 'plot', sub, values);
  switch (verb) {
    case 'l': {
      staffOnly();
      const list = Object.values(pl.doc(s)).sort((a, b) => byName(a.name, b.name));
      const to = q.d ? 'dd' : q.e ? 'e' : 'v';
      const rows = list.map((p) => row(link('plots', [to], { p: p.name }), p.name, `${p.owner}, ${p.chunks.length} chunk${p.chunks.length === 1 ? '' : 's'}`, to === 'dd' ? { c: 1, w: 1 } : {}));
      return page(q.d ? 'Delete which plot?' : q.e ? 'Edit which plot?' : 'Plots', rows, { status: list.length ? (q.d ? 'Tap twice to delete.' : '') : 'No plots yet.', r: link('plots', ['l'], { e: q.e, d: q.d }) });
    }
    case 'c': {
      staffOnly();
      const chunk = await t.chunkOf(env, env.player);
      if (!chunk) throw new UserError('Could not read the chunk you stand in.');
      const clash = pl.at(s, chunk);
      if (clash) return { ok: false, title: 'Taken', text: `Chunk ${chunk} already belongs to ${clash.name}.` };
      const owners = [env.player, ...t.online(env).filter((n) => n.toLowerCase() !== env.player.toLowerCase())];
      const rows = owners.map((o) => row(link('plots', ['cc'], { o }), o === env.player ? `Me (${o})` : o, `owns a new plot at ${chunk}`, { c: 1 }));
      return page('Who owns it?', rows, { status: `New plot on chunk ${chunk}, where you stand`, r: 'plots/c' });
    }
    case 'cc': {
      staffOnly();
      const owner = String(q.o || '');
      if (!isSafeName(owner)) throw new UserError('Pick an owner.');
      const chunk = await t.chunkOf(env, env.player);
      if (!chunk) throw new UserError('Could not read the chunk you stand in.');
      const taken = pl.doc(s);
      let plotName = null;
      for (let i = 1; !plotName && i < 50; i += 1) {
        const n = (i === 1 ? owner : `${owner} ${i}`).toLowerCase().replace(/[^a-z0-9 _-]/g, '').trim() || `plot ${i}`;
        if (!taken[n]) plotName = n;
      }
      const made = await go('claim', { name: plotName, owner, chunks: chunk });
      if (!made.ok) return result(made, 'Plot');
      await go('spawn', { plot: plotName, player: env.player }).catch(() => null);
      return { ok: true, title: 'Plot created', rows: [], text: `${plotName} for ${owner} on chunk ${chunk}. Its arrival spot is where you stand. Grow it from Edit.` };
    }
    case 'here': {
      const chunk = await t.chunkOf(env, env.player);
      const p = chunk ? pl.at(s, chunk) : null;
      if (!p) return { ok: true, title: 'No plot here', rows: [], text: chunk ? `Chunk ${chunk} has no plot.` : 'Could not read where you are.' };
      return plots(t, env, 'v', { p: p.name });
    }
    case 'v': {
      const p = get();
      if (!env.staff && !pl.allowed(s, p, env.player)) throw new UserError('That is not your plot.');
      const rows = [];
      if (env.staff) rows.push(row(link('plots', ['go'], { p: p.name }), 'Go there', 'teleport to its arrival spot'));
      if (canManage(t, env, p)) {
        rows.push(row(link('plots', ['t'], { p: p.name }), 'Trust a player', 'they can enter'));
        if (p.trusted.length) rows.push(row(link('plots', ['u'], { p: p.name }), 'Untrust a player', `${p.trusted.length} trusted`));
      }
      rows.push(row(link('plots', ['pref'], { p: p.name }), 'Main plot', 'the plot tree sends you here'));
      if (env.staff || canManage(t, env, p)) rows.push(row(link('plots', ['e'], { p: p.name }), 'Edit', 'grow, shrink, mode, arrival'));
      if (env.staff) rows.push(row(link('plots', ['dd'], { p: p.name }), 'Delete', 'the plot is gone', { c: 1, w: 1 }));
      rows.push(...lines(`Owner ${p.owner}. Chunks ${p.chunks.join(', ')}. Mode ${p.mode}.${p.trusted.length ? ` Trusted: ${p.trusted.join(', ')}.` : ''}`));
      return page(p.name, rows, { r: link('plots', ['v'], { p: p.name }) });
    }
    case 'go':
      staffOnly();
      return result(await go('teleport', { plot: get().name, player: env.player }), 'Teleported');
    case 'pref':
      return result(await go('prefer', { plot: get().name }), 'Main plot');
    case 't':
    case 'u': {
      const p = get();
      if (!canManage(t, env, p)) throw new UserError(`Only ${p.owner} or staff can change who is trusted on ${p.name}.`);
      if (q.n) return result(await go(verb === 't' ? 'trust' : 'untrust', { plot: p.name, name: String(q.n) }), 'Done');
      const names = verb === 't'
        ? t.online(env).filter((n) => n.toLowerCase() !== p.owner.toLowerCase() && !p.trusted.some((x) => x.toLowerCase() === n.toLowerCase()))
        : p.trusted;
      const rows = names.map((n) => row(link('plots', [verb], { p: p.name, n }), n, verb === 't' ? 'can enter' : 'can no longer enter', { m: 'u' }));
      return page(verb === 't' ? 'Trust who?' : 'Untrust who?', rows.length ? rows : lines(verb === 't' ? 'Nobody else is online.' : 'Nobody is trusted.'), { r: link('plots', [verb], { p: p.name }) });
    }
    case 'e': {
      const p = get();
      if (!canManage(t, env, p)) throw new UserError('Only the owner or staff can edit this plot.');
      const rows = [];
      if (env.staff) {
        rows.push(row(link('plots', ['g'], { p: p.name }), 'Grow here', 'add the chunk you stand in', { c: 1 }));
        rows.push(row(link('plots', ['s'], { p: p.name }), 'Shrink here', 'remove the chunk you stand in', { c: 1 }));
        rows.push(row(link('plots', ['m'], { p: p.name }), `Mode: ${p.mode}`, 'what happens to intruders'));
      }
      rows.push(row(link('plots', ['sp'], { p: p.name }), 'Arrival spot here', 'where Go there and the tree land', { c: 1 }));
      return page(`Edit ${p.name}`, rows, { status: `Chunks ${p.chunks.join(', ')}`, r: link('plots', ['e'], { p: p.name }) });
    }
    case 'g':
      staffOnly();
      return result(await go('grow', { plot: get().name, player: env.player }), 'Grown');
    case 's': {
      staffOnly();
      const chunk = await t.chunkOf(env, env.player);
      if (!chunk) throw new UserError('Could not read the chunk you stand in.');
      return result(await go('shrink', { plot: get().name, chunk }), 'Shrunk');
    }
    case 'sp':
      return result(await go('spawn', { plot: get().name, player: env.player }), 'Arrival spot');
    case 'm': {
      staffOnly();
      const p = get();
      const leaf = t.forms.leaf('plot', 'mode');
      const opt = leaf && leaf.options.find((o) => o.name === 'mode');
      if (q.v) return result(await go('mode', { plot: p.name, mode: String(q.v) }), 'Mode');
      const rows = (opt ? opt.choices : []).map((c) => row(link('plots', ['m'], { p: p.name, v: c.value }), c.name, '', { m: 'u' }));
      return page('Mode', rows, { status: `Now: ${p.mode}`, r: link('plots', ['m'], { p: p.name }) });
    }
    case 'dd':
      staffOnly();
      return result(await go('delete', { plot: get().name }), 'Deleted');
    default: {
      if (env.staff) {
        return page('Plots', [
          row('plots/l', 'Plot list', 'every plot'),
          row('plots/c', 'Create a plot here', 'on the chunk you stand in'),
          row(link('plots', ['l'], { e: 1 }), 'Edit a plot', 'grow, shrink, trust, mode'),
          row(link('plots', ['l'], { d: 1 }), 'Delete a plot', 'pick one, tap twice'),
          row('plots/here', 'Plot where I stand', 'which plot this chunk is'),
        ], { r: 'plots' });
      }
      const mine = Object.values(pl.doc(s)).filter((p) => pl.allowed(s, p, env.player)).sort((a, b) => byName(a.name, b.name));
      const rows = mine.map((p) => row(link('plots', ['v'], { p: p.name }), p.name, p.owner.toLowerCase() === env.player.toLowerCase() ? 'yours' : `trusted by ${p.owner}`));
      rows.push(row('plots/here', 'Plot where I stand', 'which plot this chunk is'));
      return page('Plots', rows, { status: mine.length ? '' : 'You have no plot yet. Ask an admin.', r: 'plots' });
    }
  }
}

async function actions(t, env, verb, q) {
  const list = t.actionsFor(env);
  const a = q.k ? list.find((x) => x.key === String(q.k).toLowerCase()) : null;
  if (verb === 'a' || verb === 'r') {
    if (!a) throw new UserError('That action is not yours to use.');
    if (a.target === 'player' && !q.p) {
      const rows = t.online(env).map((n) => row(link('actions', ['r'], { k: a.key, p: n }), n === env.player ? `Me (${n})` : n, '', { c: 1 }));
      return page(`${a.label}: who?`, rows, { r: link('actions', ['a'], { k: a.key }) });
    }
    if (verb === 'a') return page(a.label, [row(link('actions', ['r'], { k: a.key }), `Run ${a.label}`, a.cooldown ? `then wait ${a.cooldown} min` : '', { c: 1 })], { r: link('actions', ['a'], { k: a.key }) });
    return runAction(t, env, a, a.target === 'player' ? String(q.p) : env.player);
  }
  const rows = list.sort((x, y) => byName(x.label, y.label)).map((x) => row(link('actions', ['a'], { k: x.key }), x.label, x.target === 'player' ? 'on a player you pick' : 'on you'));
  return page('Actions', rows.length ? rows : lines('No actions for your role.'), { r: 'actions' });
}

async function runAction(t, env, a, target) {
  const s = env.server;
  if (!s.online) throw new UserError('The server is not connected.');
  const who = s.find(target);
  if (!who || !isSafeName(who.username)) throw new UserError(`${target} is not online.`);
  const key = `${s.id}:${a.key}:${env.player.toLowerCase()}`;
  const last = t.used.get(key) || 0;
  const wait = a.cooldown * 60000 - (Date.now() - last);
  if (wait > 0) throw new UserError(`Wait ${Math.ceil(wait / 60000)} more minute${Math.ceil(wait / 60000) === 1 ? '' : 's'}.`);
  const kit = own(t.bot.store.get(`server-${s.id}-cc`, {}), a.key);
  if (!kit) throw new UserError('That action is gone.');
  t.used.set(key, Date.now());
  let ok = 0;
  for (const template of kit) {
    const text = template.replace(/"?\{player\}"?/g, () => quoteName(who.username));
    const r = await s.run(text, { allowError: true, timeout: 60000 });
    if (!r.error) ok += 1;
  }
  t.note(env, `action ${a.key}`, `on ${who.username}`, ok === kit.length ? 'ok' : 'error', `${ok} of ${kit.length} steps worked`);
  return { ok: ok > 0, title: a.label, rows: [], text: ok === kit.length ? `Done${who.username === env.player ? '' : ` on ${who.username}`}.` : `${ok} of ${kit.length} steps worked.` };
}

async function players(t, env, verb, q) {
  const s = env.server;
  if (verb === 'v' || verb === 'b' || verb === 'f') {
    const who = String(q.p || '');
    const p = s.find(who);
    if (!p) throw new UserError(`${who} is not online.`);
    const n = p.username;
    if (verb === 'f') return freeze(t, env, n, q.on === '1');
    if (verb === 'b') {
      const reason = `Banned in game by ${env.player}`;
      const rows = [[24, '1 day'], [168, '1 week'], [0, 'Forever']].map(([h, label]) => row(link('players', ['x', 'ban', 'add'], { player: n, hours: h || null, reason }), label, '', { c: 1, w: h === 0 ? 1 : 0 }));
      return page(`Ban ${n}`, rows, { status: 'Tap twice. The bot keeps the ban.', r: link('players', ['b'], { p: n }) });
    }
    const x = (cmd, sub, values, label, d, extra) => row(link('players', ['x', cmd, sub || NONE], values), label, d, extra);
    const rows = [
      x('tp', 'summon', { player: n }, 'Bring', 'to you'),
      x('tp', 'goto', { target: n }, 'TP to', 'go to them'),
      x('heal', null, { player: n }, 'Heal', 'to full'),
      row(link('players', ['f'], { p: n, on: 1 }), 'Freeze', 'they cannot walk', { c: 1 }),
      row(link('players', ['f'], { p: n, on: 0 }), 'Unfreeze', 'walking speed back'),
      x('kick', null, { player: n }, 'Kick', 'they can come back', { c: 1 }),
      row(link('players', ['b'], { p: n }), 'Ban', '1 day, 1 week or forever'),
      x('kill', null, { player: n }, 'Kill', '', { c: 1, w: 1 }),
      x('godmode', null, { player: n, on: 'true' }, 'God mode on', ''),
      x('godmode', null, { player: n, on: 'false' }, 'God mode off', ''),
      x('player', 'inventory', { player: n }, 'Inventory', 'what they carry'),
      x('player', 'info', { player: n }, 'Info', 'where, health, plot'),
    ].filter((r) => n.toLowerCase() !== env.player.toLowerCase() || !/^(Bring|TP to|Kick|Ban)$/.test(r.t));
    if (env.pages.includes('spawn')) rows.push(row(link('spawn', ['w', 'spawn', NONE], { player: n, amount: 1 }), 'Spawn for them', 'pick an item'));
    if (env.pages.includes('commands')) rows.push(row(link('commands', ['on'], { p: n }), 'More commands', `every command for ${n}`));
    return page(n, rows, { r: link('players', ['v'], { p: n }) });
  }
  if (s.online && Date.now() - (s.rosterAt || 0) > 15000) await s.refreshRoster().catch(() => {});
  const list = t.online(env);
  const rows = list.map((n) => row(link('players', ['v'], { p: n }), n === env.player ? `Me (${n})` : n, ''));
  return page('Players', rows, { status: list.length ? `${list.length} online` : 'Nobody is online.', r: 'players' });
}

async function freeze(t, env, name, on) {
  const s = env.server;
  const key = `${s.id}:${name.toLowerCase()}`;
  const st = await s.stat(name, 'speed');
  if (on) {
    if (!t.frozen.has(key)) t.frozen.set(key, st.base);
    await s.setStat(name, st.name, 0);
  } else {
    const back = t.frozen.has(key) ? t.frozen.get(key) : st.base > 0 ? st.base : 1;
    t.frozen.delete(key);
    await s.setStat(name, st.name, back);
  }
  t.note(env, on ? 'freeze' : 'unfreeze', name, 'ok');
  return { ok: true, title: on ? 'Frozen' : 'Unfrozen', rows: [], text: on ? `${name} cannot walk until you unfreeze them.` : `${name} can walk again.` };
}

async function spawn(t, env) {
  const rows = [
    row(link('spawn', ['w', 'spawn', NONE], { player: env.player, amount: 1 }), 'Spawn an item', 'at you or a player'),
    row(link('spawn', ['w', 'mail', NONE], { player: env.player, amount: 1 }), 'Mail an item', 'to a mailbox, stacks come in pouches'),
  ];
  if (t.may(env, 'spawn', 'kit', 'give')) rows.push(row(link('spawn', ['w', 'kit', 'give'], { player: env.player }), 'Give a kit', 'a saved set of items'));
  return page('Spawn', rows, { r: 'spawn' });
}

async function cleanup(t, env, verb, q) {
  const s = env.server;
  if (verb === 'n') {
    return page('Clear near me', RADII.map((r) => row(link('cleanup', ['nc'], { r }), `Within ${r} m`, 'count first, then clear')), { status: 'Loose items on the ground only', r: 'cleanup/n' });
  }
  if (verb === 'nc' || verb === 'nr') {
    if (!atLeast(s.botcore, 1, 6)) throw new UserError('Clear near me needs BotCore 1.6 on the server.');
    const r = Math.min(50, Math.max(1, Number.parseInt(q.r, 10) || 10));
    const run = verb === 'nr';
    const res = await s.run(`botcore sweep near ${quoteName(env.player)} ${r} ${run ? 'run' : 'count'}`, { timeout: 60000 });
    const text = String(res.resultString || '');
    const head = text.split('\n')[0];
    const m = head.match(/(\d+) loose item/);
    const count = m ? Number(m[1]) : 0;
    const list = text.split('\n').slice(1).map((l) => l.trim().match(/^(\d+)\s+(.+)$/)).filter(Boolean).slice(0, 12).map((x) => `${x[2]} x${x[1]}`).join(', ');
    if (run) {
      t.note(env, 'clear near', `${r} m`, 'ok', head);
      const done = head.match(/CLEARED (\d+)/);
      return { ok: true, title: 'Cleared', rows: [], text: `${done ? done[1] : count} loose items within ${r} m are gone.` };
    }
    if (count === 0) return { ok: true, title: 'Nothing to clear', rows: [], text: `No loose items within ${r} m.` };
    return { ok: true, title: `${count} items within ${r} m`, rows: [row(link('cleanup', ['nr'], { r }), 'Clear them', 'they are gone for good', { c: 1, w: 1, m: 's' })], text: list };
  }
  if (verb === 'd' || verb === 'ds') {
    if (verb === 'ds') {
      const n = Math.min(50, Math.max(0, Number.parseInt(q.n, 10) || 0));
      t.setSession(s, env.player, n ? { mode: 'destroy', left: n } : null);
      t.note(env, 'destroy on pickup', n ? `${n} items` : 'off', 'ok');
    }
    const cur = t.session(s, env.player);
    const status = cur && cur.mode === 'destroy' ? `On: the next ${cur.left} you pick up are destroyed` : 'Off';
    const rows = [1, 5, 10].map((n) => row(link('cleanup', ['ds'], { n }), `Destroy the next ${n}`, 'for 5 minutes', { m: 's', w: 1 }));
    rows.push(row(link('cleanup', ['ds'], { n: 0 }), 'Stop', 'pick up normally again', { m: 's' }));
    return page('Destroy what I pick up', rows, { status, r: 'cleanup/d' });
  }
  if (verb === 'i' || verb === 'is') {
    if (verb === 'is') t.setSession(s, env.player, q.on === '1' ? { mode: 'info', left: 0 } : null);
    const cur = t.session(s, env.player);
    const on = Boolean(cur && cur.mode === 'info');
    return page('What is this item?', [
      row(link('cleanup', ['is'], { on: 1 }), 'On for 5 minutes', 'pick up items to see name and code', { m: 's' }),
      row(link('cleanup', ['is'], { on: 0 }), 'Off', '', { m: 's' }),
    ], { status: on ? 'On: pick something up' : 'Off', r: 'cleanup/i' });
  }
  if (verb === 'r') {
    const rules = Object.keys(t.bot.cleanup.rules(s)).sort();
    const rows = rules.map((name) => row(link('cleanup', ['rv'], { n: name }), name, ''));
    return page('Cleanup rules', rows.length ? rows : lines('No cleanup rules yet. Add them on Discord with /cleanup.'), { r: 'cleanup/r' });
  }
  if (verb === 'rv') {
    const name = String(q.n || '');
    return page(name, [
      row(link('cleanup', ['x', 'cleanup', 'preview'], { rule: name }), 'Preview', 'count what it would remove'),
      row(link('cleanup', ['x', 'cleanup', 'run'], { rule: name }), 'Run now', 'remove the loose items', { c: 1, w: 1 }),
    ], { r: link('cleanup', ['rv'], { n: name }) });
  }
  const rows = [
    row('cleanup/n', 'Clear near me', 'loose items around you'),
    row('cleanup/d', 'Destroy what I pick up', 'the next few items you grab'),
    row('cleanup/i', 'What is this item?', 'name and code of what you grab'),
    row('cleanup/r', 'Cleanup rules', 'preview or run one now'),
  ];
  if (t.may(env, 'cleanup', 'cleanup', 'sweep')) rows.push(row(link('cleanup', ['w', 'cleanup', 'sweep']), 'Sweep an item', 'every loose one on the server'));
  return page('Cleanup', rows, { r: 'cleanup' });
}

async function server(t, env) {
  const x = (cmd, sub, values, label, d, extra = {}) => (t.may(env, 'server', cmd, sub) ? row(link('server', ['x', cmd, sub || NONE], values), label, d, extra) : null);
  const w = (cmd, sub, label, d) => (t.may(env, 'server', cmd, sub) ? row(link('server', ['w', cmd, sub || NONE]), label, d) : null);
  const rows = [
    x('status', null, {}, 'Status', 'players and uptime'),
    x('time', 'day', {}, 'Daytime', 'skip to morning'),
    x('time', 'night', {}, 'Night', 'skip to night'),
    x('save', 'now', {}, 'Save now', '', { c: 1 }),
    x('save', 'backup', {}, 'Backup', 'copy the save', { c: 1 }),
    x('restart', null, { warning: 60 }, 'Restart in 1 minute', 'players get a warning', { c: 1, w: 1 }),
    x('restart', null, { warning: 300 }, 'Restart in 5 minutes', 'players get a warning', { c: 1, w: 1 }),
    x('shutdown', null, { warning: 60 }, 'Shut down in 1 minute', 'nobody starts it again', { c: 1, w: 1 }),
    w('festival', 'start', 'Start a festival', ''),
    w('festival', 'stop', 'Stop a festival', ''),
    x('announce', 'list', {}, 'Announcements', 'what repeats in chat'),
    x('settings', 'show', {}, 'Server settings', 'the main values'),
  ].filter(Boolean);
  return page('Server', rows, { r: 'server' });
}

async function commands(t, env, verb, q) {
  const forms = t.forms;
  const visible = forms.leaves().filter((l) => forms.visible(env, 'commands', l));
  const wizard = (l, extra = {}) => link('commands', ['w', l.name, l.sub || NONE], extra);
  if (verb === 'on') {
    const who = String(q.p || '');
    const list = visible.filter((l) => l.options.some((o) => o.name === 'player' && o.kind === 'player'));
    return page(`Commands for ${who}`, list.map((l) => row(wizard(l, { player: who }), l.title, l.description)), { r: link('commands', ['on'], { p: who }) });
  }
  if (verb === 'c') {
    const name = String(q.c || '');
    const list = visible.filter((l) => l.name === name);
    return page(`/${name}`, list.map((l) => row(wizard(l), l.sub || l.name, l.description)), { r: link('commands', ['c'], { c: name }) });
  }
  const names = [...new Set(visible.map((l) => l.name))];
  const cmdRow = (n) => {
    const subs = visible.filter((l) => l.name === n);
    if (subs.length === 1 && !subs[0].sub) return row(wizard(subs[0]), `/${n}`, subs[0].description);
    return row(link('commands', ['c'], { c: n }), `/${n}`, `${subs.length} choices`);
  };
  if (verb === 'g') {
    const i = Number.parseInt(q.i, 10);
    const known = new Set(GROUPS.flatMap((g) => g[1]));
    const group = GROUPS[i];
    const list = group ? group[1].filter((n) => names.includes(n)) : names.filter((n) => !known.has(n));
    return page(group ? group[0] : 'More', list.map(cmdRow), { r: link('commands', ['g'], { i: q.i }) });
  }
  const rows = [];
  GROUPS.forEach(([title, list], i) => {
    const n = list.filter((c) => names.includes(c)).length;
    if (n) rows.push(row(link('commands', ['g'], { i }), title, `${n} command${n === 1 ? '' : 's'}`));
  });
  const known = new Set(GROUPS.flatMap((g) => g[1]));
  const extra = names.filter((n) => !known.has(n)).length;
  if (extra) rows.push(row(link('commands', ['g'], { i: 'more' }), 'More', `${extra} command${extra === 1 ? '' : 's'}`));
  return page('Commands', rows.length ? rows : lines('No commands for you here.'), { r: 'commands' });
}

module.exports = { shop, sell, me, plots, actions, players, spawn, cleanup, server, commands };
