const materials = require('../core/materials');
const { UserError, own, RESERVED, quoteName } = require('../game/text');

const MAX_BUY = 25;
const MAX_SELL = 100;
const STALE_MS = 120000;
const POUCH = 61648;
const ATM = /^ATM Coin Bank/i;
const ATM_METERS = 15;

class Economy {
  constructor(bot) {
    this.bot = bot;
    this.busy = new Map();
  }

  shop(server) {
    const d = this.bot.store.get(`server-${server.id}-shop`, () => ({}));
    if (!d.items) d.items = {};
    if (d.atmDistance == null) d.atmDistance = d.blockTownHall === false ? 0 : ATM_METERS;
    delete d.blockTownHall;
    return d;
  }

  saveShop(server) {
    this.bot.store.save(`server-${server.id}-shop`);
  }

  buyback(server) {
    const d = this.bot.store.get(`server-${server.id}-sell`, () => ({}));
    if (!d.items) d.items = {};
    if (d.paused == null) d.paused = false;
    if (!d.sold) d.sold = {};
    return d;
  }

  saveBuyback(server) {
    this.bot.store.save(`server-${server.id}-sell`);
  }

  ledger(server) {
    const d = this.bot.store.get(`server-${server.id}-ledger`, () => ({}));
    if (!d.pending) d.pending = [];
    if (!d.next) d.next = 1;
    return d;
  }

  open(server, row) {
    const d = this.ledger(server);
    const full = { id: d.next, at: Date.now(), ...row };
    d.next += 1;
    d.pending.push(full);
    this.bot.store.write(`server-${server.id}-ledger`);
    return full;
  }

  update(server, row, fields) {
    Object.assign(row, fields);
    this.bot.store.write(`server-${server.id}-ledger`);
  }

  close(server, row) {
    const d = this.ledger(server);
    d.pending = d.pending.filter((r) => r.id !== row.id);
    this.bot.store.write(`server-${server.id}-ledger`);
  }

  settle(server, id) {
    const d = this.ledger(server);
    const row = d.pending.find((r) => r.id === Number(id));
    if (!row) return null;
    d.pending = d.pending.filter((r) => r.id !== row.id);
    this.bot.store.save(`server-${server.id}-ledger`);
    return row;
  }

  log(server, text) {
    this.bot.logs.line(server, 'shop', text);
  }

  async lock(server, name, what, fn) {
    const key = `${server.id}:${String(name).toLowerCase()}`;
    const held = this.busy.get(key);
    if (held && Date.now() - held.since < STALE_MS) throw new UserError(`${name} still has ${held.what} running. Try again in a moment.`);
    if (held) console.warn(`[economy] a lock for ${name} (${held.what}) went stale and was cleared.`);
    const mine = { since: Date.now(), what };
    this.busy.set(key, mine);
    try {
      return await fn();
    } finally {
      if (this.busy.get(key) === mine) this.busy.delete(key);
    }
  }

  async coins(server, user) {
    const v = Number(await server.value(`trade atm get "${user.username}"`));
    if (!Number.isFinite(v)) throw new UserError(`Could not read the ATM of ${user.username}.`);
    return v;
  }

  async change(server, user, before, delta) {
    const raw = await server.value(`trade atm add "${user.username}" ${delta}`);
    if (Number(raw) === before + delta) return before + delta;
    const now = await this.coins(server, user);
    return now === before + delta ? now : null;
  }

  counted(doc, day, name, key) {
    const d = doc.sold[day];
    return (d && d[name.toLowerCase()] && d[name.toLowerCase()][key]) || 0;
  }

  addCount(doc, day, name, key, n) {
    if (RESERVED.has(name.toLowerCase())) return;
    for (const old of Object.keys(doc.sold)) if (old !== day) delete doc.sold[old];
    const d = doc.sold[day] = doc.sold[day] || {};
    const who = d[name.toLowerCase()] = d[name.toLowerCase()] || {};
    who[key] = (who[key] || 0) + n;
  }

  today() {
    return new Date().toISOString().slice(0, 10);
  }

  async checkPlace(server, user) {
    const meters = this.shop(server).atmDistance;
    if (user.state !== 'online' || !meters) return;
    const list = await server.selected(() => server.value(`select find ${quoteName(user.username)} ${meters}`)).catch(() => null);
    if (Array.isArray(list) && list.some((e) => ATM.test(String(e && e.Name)))) throw new UserError(`You cannot do this within ${meters} m of an ATM. Step away first.`);
  }

  assertNoLoop(server, hash, { buy = null, sell = null, material = null }) {
    const fits = (x) => x.hash === Number(hash) && (!material || !x.material || x.material === material);
    const shopPrices = Object.values(this.shop(server).items).filter(fits).map((x) => x.price);
    const sellPrices = Object.values(this.buyback(server).items).filter(fits).map((x) => x.price);
    const buyPrice = buy ?? (shopPrices.length ? Math.min(...shopPrices) : null);
    const sellPrice = sell ?? (sellPrices.length ? Math.max(...sellPrices) : null);
    if (buyPrice != null && sellPrice != null && sellPrice >= buyPrice) {
      throw new UserError(`The bot would pay ${sellPrice} for an item it sells for ${buyPrice}, so anyone could print coins. Keep the sell price under the shop price.`);
    }
  }

  async buy(ctx, item, amount) {
    const s = ctx.needOnline();
    const name = ctx.self();
    const user = await s.lookup(name);
    if (amount < 1 || amount > MAX_BUY) throw new UserError(`You can buy 1 to ${MAX_BUY} at a time.`);
    if (item.role && amount !== 1) throw new UserError('A role can only be bought once.');
    const doc = this.shop(s);
    if (item.daily) {
      if (!doc.sold) doc.sold = {};
      const left = item.daily - this.counted(doc, this.today(), user.username, item.key);
      if (left < amount) throw new UserError(`You can buy ${Math.max(0, left)} more ${item.name} today.`);
    }
    return this.lock(s, user.username, 'a purchase', async () => {
      const total = item.price * amount;
      const before = await this.coins(s, user);
      if (before < total) throw new UserError(`${amount} x ${item.name} costs ${total} coins and you have ${before}.`);
      await this.checkPlace(s, user);
      const member = ctx.i.member;
      if (item.role && member && member.roles && member.roles.cache && member.roles.cache.has(item.role)) throw new UserError(`You already have the role ${item.name}.`);
      const row = this.open(s, { kind: 'buy', player: user.username, item: item.name, amount, coins: total, state: 'taking' });
      const after = await this.change(s, user, before, -total);
      if (after == null) {
        this.update(s, row, { state: 'coins unconfirmed' });
        this.log(s, `**${user.username}**: a purchase of ${item.name} could not confirm the coins. See /shop pending, row ${row.id}.`);
        throw new UserError('The ATM did not confirm the payment, so nothing was delivered. An admin can see this in /shop pending.');
      }
      this.update(s, row, { state: 'paid' });
      let delivered = 0;
      let problem = null;
      let unknown = false;
      if (item.role) {
        try {
          await member.roles.add(item.role);
          delivered = 1;
        } catch (e) {
          problem = `Discord refused the role (${e.message}). Does the bot have Manage Roles, above that role?`;
        }
      } else {
        for (let i = 0; i < amount; i += 1) {
          let r;
          try {
            r = await s.run(`trade post "${user.username}" ${item.hash}${item.material ? ` ${item.material}` : ''} 1${item.forged ? ' forged' : ''}`, { allowError: true });
          } catch (e) {
            unknown = true;
            problem = e.message;
            break;
          }
          if (r.error) {
            problem = r.error;
            break;
          }
          delivered += 1;
        }
      }
      if (unknown) {
        this.update(s, row, { state: `console lost after ${delivered} of ${amount} delivered, check the mailbox`, delivered });
        this.log(s, `**${user.username}**: the console dropped during a purchase of ${item.name}. See /shop pending, row ${row.id}.`);
        throw new UserError(`The console dropped after ${delivered} of ${amount} were sent. An admin can see this in /shop pending, row ${row.id}.`);
      }
      const refund = (amount - delivered) * item.price;
      let final = after;
      if (refund > 0) {
        final = await this.change(s, user, after, refund);
        if (final == null) {
          this.update(s, row, { state: `owed a refund of ${refund}`, delivered });
          this.log(s, `**${user.username}** is owed ${refund} coins for ${item.name}. See /shop pending, row ${row.id}.`);
          throw new UserError(`Only ${delivered} of ${amount} were delivered and the refund of ${refund} coins could not be confirmed. An admin can see this in /shop pending.`);
        }
      }
      if (item.daily && delivered > 0) {
        this.addCount(doc, this.today(), user.username, item.key, delivered);
        this.bot.store.write(`server-${s.id}-shop`);
      }
      this.close(s, row);
      if (delivered === 0) throw new UserError(`Nothing was delivered and your coins were returned. ${problem || ''}`.trim());
      ctx.note(`${delivered} x ${item.name} for ${delivered * item.price} coins`);
      this.log(s, `**${user.username}** bought ${delivered} x ${item.name} for ${delivered * item.price} coins, ${final} left.`);
      return { delivered, amount, spent: delivered * item.price, left: final, problem };
    });
  }

  parseTake(text) {
    const m = String(text).match(/^(count|taken) (\d+) (\d+)$/);
    if (!m) throw new UserError(`The server answered in a way the bot does not understand: ${String(text).slice(0, 80)}. Is BotCore 1.2.0 or newer installed?`);
    return { n: Number(m[2]), refused: Number(m[3]) };
  }

  sellKey(entry) {
    return entry.material ? `${entry.hash}:${entry.material}` : String(entry.hash);
  }

  sellInfo(s, entry, username, wanted) {
    const doc = this.buyback(s);
    const left = entry.daily ? entry.daily - this.counted(doc, this.today(), username, this.sellKey(entry)) : MAX_SELL;
    return Math.min(wanted || MAX_SELL, Math.max(0, left), MAX_SELL);
  }

  saleEntries(doc, text) {
    const key = String(text).trim().toLowerCase();
    const list = Object.values(doc.items);
    const every = (hash) => list.filter((x) => x.hash === hash);
    const group = key.match(/^all:(\d+)$/);
    if (group) return every(Number(group[1]));
    const hit = own(doc.items, key) || list.find((x) => x.name.toLowerCase() === key);
    if (hit) return hit.material ? [hit] : every(hit.hash);
    const base = list.find((x) => String(x.base || '').toLowerCase() === key);
    return base ? every(base.hash) : [];
  }

  parseCarried(text) {
    const m = String(text).match(/^carried (\d+) (.+)$/);
    if (!m) throw new UserError(`The server answered in a way the bot does not understand: ${String(text).slice(0, 80)}. Is BotCore 1.3.0 or newer installed?`);
    const kinds = m[2] === '-' ? [] : m[2].split('|').map((part) => {
      const at = part.lastIndexOf('=');
      return { raw: part.slice(0, at), n: Number(part.slice(at + 1)) };
    });
    return { refused: Number(m[1]), kinds };
  }

  needMaterials(s) {
    const m = String(s.botcore || '').match(/^BotCore (\d+)\.(\d+)/);
    if (!m || Number(m[1]) < 1 || (Number(m[1]) === 1 && Number(m[2]) < 3)) throw new UserError('Prices by wood or metal need BotCore 1.3.0 or newer on the game server.');
  }

  async planSale(s, user, entries, wanted) {
    const plain = entries.find((e) => !e.material) || null;
    const priced = new Map(entries.filter((e) => e.material).map((e) => [e.material, e]));
    const hash = entries[0].hash;
    if (priced.size === 0) {
      const limit = this.sellInfo(s, plain, user.username, wanted);
      if (limit <= 0) throw new UserError(`You hit today's limit of ${plain.daily} for ${plain.name}.`);
      const look = this.parseTake(await s.value(`botcore take "${user.username}" ${hash} ${limit} count all`));
      return { rows: look.n ? [{ entry: plain, n: look.n, filter: null, label: plain.name }] : [], refused: look.refused, unpriced: [], capped: false };
    }
    this.needMaterials(s);
    const carried = this.parseCarried(await s.value(`botcore carried "${user.username}" ${hash} all`));
    const unpriced = [];
    const kinds = [];
    for (const k of carried.kinds) {
      const entry = priced.get(materials.squash(k.raw)) || plain;
      if (entry) kinds.push({ ...k, entry });
      else unpriced.push(materials.label(k.raw));
    }
    kinds.sort((a, b) => b.entry.price - a.entry.price);
    const rows = [];
    const used = new Map();
    let room = Math.min(wanted || MAX_SELL, MAX_SELL);
    for (const k of kinds) {
      const key = this.sellKey(k.entry);
      const n = Math.min(k.n, this.sellInfo(s, k.entry, user.username, room) - (used.get(key) || 0));
      if (n <= 0) continue;
      used.set(key, (used.get(key) || 0) + n);
      room -= n;
      const label = k.entry.material || k.raw === 'none' ? k.entry.name : `${k.entry.name} (${materials.label(k.raw)})`;
      rows.push({ entry: k.entry, n, filter: materials.squash(k.raw), label });
    }
    return { rows, refused: carried.refused, unpriced, capped: kinds.length > 0 && rows.length === 0 };
  }

  async sell(ctx, entries, wanted) {
    const first = entries[0];
    const title = first.base || first.name;
    const s = ctx.needOnline();
    const doc = this.buyback(s);
    if (doc.paused) throw new UserError('The bot is not buying anything right now.');
    const name = ctx.self();
    const user = await s.lookup(name);
    if (user.state !== 'online') throw new UserError('You have to be in game, carrying what you want to sell.');
    return this.lock(s, user.username, 'a sale', async () => {
      await this.checkPlace(s, user);
      const plan = await this.planSale(s, user, entries, wanted);
      const skipped = plan.unpriced.length ? ` The bot does not buy ${plan.unpriced.join(', ')}.` : '';
      if (plan.rows.length === 0) {
        if (plan.capped) throw new UserError(`You hit today's limit for ${title}.`);
        throw new UserError(plan.refused
          ? `You carry ${title} with things stored inside. Empty it first.`
          : `You are not carrying any ${title} the bot buys. Hold it, or keep it on your belt or in your bag.${skipped}`);
      }
      const offer = plan.rows.reduce((sum, r) => sum + r.n * r.entry.price, 0);
      const count = plan.rows.reduce((sum, r) => sum + r.n, 0);
      const what = (rows) => rows.map((r) => `${r.n} x ${r.label}`).join(', ');
      const text = plan.rows.length === 1
        ? `**${what(plan.rows)}** for **${offer} coins**`
        : `${plan.rows.map((r) => `${r.n} x ${r.label} at ${r.entry.price}: ${r.n * r.entry.price}`).join('\n')}\n\nTotal **${offer} coins**`;
      if (!(await ctx.confirm('Sell these?', `${text}, paid to your ATM. The items are gone once you confirm.${skipped}`, { label: 'Sell', danger: false }))) return null;
      const row = this.open(s, { kind: 'sell', player: user.username, item: plan.rows.map((r) => r.label).join(', '), amount: count, coins: offer, state: 'taking items' });
      const sold = [];
      let pay = 0;
      for (const r of plan.rows) {
        let done;
        try {
          done = this.parseTake(await s.value(`botcore take "${user.username}" ${r.entry.hash} ${r.n} take all${r.filter ? ` ${r.filter}` : ''}`));
        } catch (e) {
          this.update(s, row, { state: `stopped while taking items, ${pay} coins owed for ${what(sold) || 'nothing'}`, coins: pay });
          throw new UserError(`The sale stopped halfway. An admin can see this in /shop pending, row ${row.id}.`);
        }
        if (done.n > 0) {
          sold.push({ ...r, n: done.n });
          pay += done.n * r.entry.price;
        }
      }
      if (sold.length === 0) {
        this.close(s, row);
        throw new UserError(`The ${title} is gone from your inventory, so nothing was sold.`);
      }
      const total = sold.reduce((sum, r) => sum + r.n, 0);
      this.update(s, row, { state: 'items taken, coins owed', amount: total, coins: pay });
      const before = await this.coins(s, user);
      const after = await this.change(s, user, before, pay);
      if (after == null) {
        this.log(s, `**${user.username}** sold ${what(sold)} and is owed ${pay} coins. See /shop pending, row ${row.id}.`);
        throw new UserError(`Your items were taken but the ATM did not confirm the ${pay} coins. An admin can see this in /shop pending, row ${row.id}.`);
      }
      for (const r of sold) if (r.entry.daily) this.addCount(doc, this.today(), user.username, this.sellKey(r.entry), r.n);
      this.bot.store.write(`server-${s.id}-sell`);
      this.close(s, row);
      ctx.note(`${what(sold)} for ${pay} coins`);
      this.log(s, `**${user.username}** sold ${what(sold)} for ${pay} coins, now has ${after}.`);
      return { sold: total, paid: pay, balance: after, what: what(sold) };
    });
  }

  async withdraw(ctx, amount) {
    const s = ctx.needOnline();
    const name = ctx.self();
    const user = await s.lookup(name);
    return this.lock(s, user.username, 'a withdrawal', async () => {
      const before = await this.coins(s, user);
      if (before < amount) throw new UserError(`You have ${before} coins.`);
      await this.checkPlace(s, user);
      const row = this.open(s, { kind: 'withdraw', player: user.username, item: 'gold pouch', amount: 1, coins: amount, state: 'taking' });
      const after = await this.change(s, user, before, -amount);
      if (after == null) {
        this.update(s, row, { state: 'coins unconfirmed' });
        throw new UserError('The ATM did not confirm the withdrawal, so no pouch was sent. An admin can see this in /shop pending.');
      }
      this.update(s, row, { state: 'paid' });
      let r;
      try {
        r = await s.run(`trade post "${user.username}" ${POUCH} ${amount}`, { allowError: true });
      } catch (e) {
        this.update(s, row, { state: 'console lost while sending the pouch, check the mailbox' });
        this.log(s, `**${user.username}**: the console dropped during a withdrawal. See /shop pending, row ${row.id}.`);
        throw new UserError(`The console dropped while sending your pouch. An admin can see this in /shop pending, row ${row.id}.`);
      }
      if (r.error) {
        const back = await this.change(s, user, after, amount);
        if (back == null) {
          this.update(s, row, { state: `owed a refund of ${amount}` });
          throw new UserError('The pouch could not be sent and the refund could not be confirmed. An admin can see this in /shop pending.');
        }
        this.close(s, row);
        throw new UserError(`The pouch could not be sent, so your coins were returned. ${r.error}`);
      }
      this.close(s, row);
      ctx.note(`${amount} coins`);
      this.log(s, `**${user.username}** withdrew ${amount} coins, ${after} left.`);
      return { after };
    });
  }

  start() {
    for (const server of this.bot.servers.values()) {
      server.on('ready', () => {
        const rows = this.ledger(server).pending;
        if (rows.length) this.log(server, `${rows.length} shop row(s) did not finish. See /shop pending.`);
      });
    }
  }
}

Economy.MAX_BUY = MAX_BUY;
Economy.MAX_SELL = MAX_SELL;
module.exports = Economy;
