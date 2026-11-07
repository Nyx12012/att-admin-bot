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

  assertNoLoop(server, hash, { buy = null, sell = null }) {
    const shopItem = Object.values(this.shop(server).items).find((x) => x.hash === Number(hash));
    const sellItem = own(this.buyback(server).items, String(hash));
    const buyPrice = buy ?? (shopItem && shopItem.price);
    const sellPrice = sell ?? (sellItem && sellItem.price);
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
            r = await s.run(`trade post "${user.username}" ${item.hash} 1`, { allowError: true });
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

  sellInfo(s, entry, username, wanted) {
    const doc = this.buyback(s);
    const left = entry.daily ? entry.daily - this.counted(doc, this.today(), username, String(entry.hash)) : MAX_SELL;
    return Math.min(wanted || MAX_SELL, Math.max(0, left), MAX_SELL);
  }

  async sell(ctx, entry, wanted) {
    const s = ctx.needOnline();
    const doc = this.buyback(s);
    if (doc.paused) throw new UserError('The bot is not buying anything right now.');
    const name = ctx.self();
    const user = await s.lookup(name);
    if (user.state !== 'online') throw new UserError('You have to be in game, carrying what you want to sell.');
    const limit = this.sellInfo(s, entry, user.username, wanted);
    if (limit <= 0) throw new UserError(`You hit today's limit of ${entry.daily} for ${entry.name}.`);
    return this.lock(s, user.username, 'a sale', async () => {
      await this.checkPlace(s, user);
      const look = this.parseTake(await s.value(`botcore take "${user.username}" ${entry.hash} ${limit} count all`));
      if (look.n === 0) {
        throw new UserError(look.refused
          ? `You carry ${entry.name} with things stored inside. Empty it first.`
          : `You are not carrying any ${entry.name}. Hold it, or keep it on your belt or in your bag.`);
      }
      const offer = look.n * entry.price;
      if (!(await ctx.confirm('Sell these?', `**${look.n} x ${entry.name}** for **${offer} coins**, paid to your ATM. The items are gone once you confirm.`, { label: 'Sell', danger: false }))) return null;
      const row = this.open(s, { kind: 'sell', player: user.username, item: entry.name, amount: look.n, coins: offer, state: 'taking items' });
      const done = this.parseTake(await s.value(`botcore take "${user.username}" ${entry.hash} ${look.n} take all`));
      if (done.n === 0) {
        this.close(s, row);
        throw new UserError(`The ${entry.name} is gone from your inventory, so nothing was sold.`);
      }
      const pay = done.n * entry.price;
      this.update(s, row, { state: 'items taken, coins owed', amount: done.n, coins: pay });
      const before = await this.coins(s, user);
      const after = await this.change(s, user, before, pay);
      if (after == null) {
        this.log(s, `**${user.username}** sold ${done.n} x ${entry.name} and is owed ${pay} coins. See /shop pending, row ${row.id}.`);
        throw new UserError(`Your items were taken but the ATM did not confirm the ${pay} coins. An admin can see this in /shop pending, row ${row.id}.`);
      }
      if (entry.daily) this.addCount(doc, this.today(), user.username, String(entry.hash), done.n);
      this.bot.store.write(`server-${s.id}-sell`);
      this.close(s, row);
      ctx.note(`${done.n} x ${entry.name} for ${pay} coins`);
      this.log(s, `**${user.username}** sold ${done.n} x ${entry.name} for ${pay} coins, now has ${after}.`);
      return { sold: done.n, paid: pay, balance: after };
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
