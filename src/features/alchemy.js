const { isSafeName, quoteName, vec, distance, own, UserError } = require('../game/text');
const items = require('../core/items');

const SETTLE_MS = 2000;
const HAND_POLL_MS = 500;
const HAND_DISTANCE = 0.15;
const ARM_MS = 120000;
const BUFF_SECONDS = 15;
const SWEEP_MS = 60000;
const STAT = /^[A-Za-z-]{2,40}$/;

function blueprintOf(prefab) {
  const kids = (prefab.children || []).map((c) => blueprintOf(c.prefab)).sort();
  const material = typeof prefab.getMaterial === 'function' ? prefab.getMaterial() : null;
  return `${prefab.hash}:${material ?? ''}[${kids.join(',')}]`;
}

function blueprint(saveString) {
  const { Prefab } = require('att-string-transcoder');
  return blueprintOf(Prefab.fromSaveString(String(saveString).trim()));
}

function beltOf(inv) {
  return (inv.Belt || []).map((e) => (e && e.Identifier != null ? { id: Number(e.Identifier), hash: Number(e.PrefabHash) } : null));
}

function match(recipe, belt) {
  const used = [];
  const filled = belt.filter(Boolean);
  if (recipe.ordered && recipe.slots.length === belt.length) {
    for (let i = 0; i < recipe.slots.length; i += 1) {
      if (!belt[i] || belt[i].hash !== recipe.slots[i]) return null;
      used.push(belt[i]);
    }
    return used;
  }
  if (recipe.ordered) {
    let at = 0;
    for (const want of recipe.slots) {
      while (at < filled.length && filled[at].hash !== want) at += 1;
      if (at >= filled.length) return null;
      used.push(filled[at]);
      at += 1;
    }
    return used;
  }
  const left = [...filled];
  for (const want of recipe.slots) {
    const i = left.findIndex((b) => b.hash === want);
    if (i < 0) return null;
    used.push(left.splice(i, 1)[0]);
  }
  return used;
}

class Alchemy {
  constructor(bot) {
    this.bot = bot;
    this.settle = new Map();
    this.armed = new Map();
    this.cooldowns = new Map();
    this.holding = new Map();
    this.strings = new Map();
    this.handTimer = null;
    this.sweepTimer = null;
    this.polling = false;
  }

  doc(server) {
    const d = this.bot.store.get(`server-${server.id}-alchemy`, () => ({}));
    if (!d.recipes) d.recipes = {};
    if (!d.holds) d.holds = {};
    return d;
  }

  save(server) {
    this.bot.store.save(`server-${server.id}-alchemy`);
    this.sync(server);
  }

  sync(server) {
    const d = this.doc(server);
    const any = Object.values(d.recipes).some((r) => r.on) || Object.values(d.holds).some((h) => h.on);
    server.want('InventoryChanged', 'alchemy', any);
  }

  sorted(server) {
    return Object.values(this.doc(server).recipes).filter((r) => r.on).sort((a, b) => b.slots.length - a.slots.length);
  }

  mayUse(rule, name) {
    return !rule.whitelist || rule.whitelist.length === 0 || rule.whitelist.some((w) => w.toLowerCase() === name.toLowerCase());
  }

  changed(server, data) {
    const user = data.User || data.user;
    const name = user && user.username;
    if (!name || !isSafeName(name)) return;
    const key = `${server.id}:${name.toLowerCase()}`;
    clearTimeout(this.settle.get(key));
    const t = setTimeout(() => {
      this.settle.delete(key);
      this.inspect(server, name).catch((e) => console.warn(`[alchemy] ${name}: ${e.message}`));
    }, SETTLE_MS);
    t.unref?.();
    this.settle.set(key, t);
  }

  async inspect(server, name) {
    if (!server.online) return;
    const inv = await server.inventory(name).catch(() => null);
    if (!inv) return;
    await this.checkRecipes(server, name, inv);
    await this.checkHolds(server, name, inv);
  }

  async checkRecipes(server, name, inv) {
    const key = `${server.id}:${name.toLowerCase()}`;
    const belt = beltOf(inv);
    const wasArmed = this.armed.get(key);
    let found = null;
    for (const recipe of this.sorted(server)) {
      if (!this.mayUse(recipe, name)) continue;
      const used = match(recipe, belt);
      if (used) {
        found = { recipe, used };
        break;
      }
    }
    if (!found) {
      this.armed.delete(key);
      return;
    }
    if (found.recipe.trigger === 'pockets') {
      this.armed.delete(key);
      await this.fire(server, name, found.recipe, found.used);
      return;
    }
    this.armed.set(key, { server, name, recipe: found.recipe, used: found.used, until: Date.now() + ARM_MS, latched: wasArmed ? wasArmed.latched : false });
    this.startHands();
  }

  startHands() {
    if (this.handTimer) return;
    this.handTimer = setInterval(() => this.pollHands().catch((e) => console.warn(`[alchemy] ${e.message}`)), HAND_POLL_MS);
    this.handTimer.unref?.();
  }

  stopHands() {
    clearInterval(this.handTimer);
    this.handTimer = null;
  }

  async pollHands() {
    if (this.polling) return;
    this.polling = true;
    try {
      for (const [key, a] of [...this.armed]) {
        const still = own(this.doc(a.server).recipes, a.recipe.name);
        if (still !== a.recipe || !a.recipe.on || a.until < Date.now() || !a.server.online || !a.server.find(a.name)) {
          this.armed.delete(key);
          continue;
        }
        const d = await a.server.detailed(a.name).catch(() => null);
        const left = vec(d && d.LeftHandPosition);
        const right = vec(d && d.RightHandPosition);
        if (!left || !right) continue;
        const together = distance(left, right) <= HAND_DISTANCE;
        if (!together) {
          a.latched = false;
          continue;
        }
        if (a.latched) continue;
        a.latched = true;
        a.until = Date.now() + ARM_MS;
        if (a.recipe.consume) this.armed.delete(key);
        await this.fire(a.server, a.name, a.recipe, a.used);
      }
    } finally {
      this.polling = false;
      if (this.armed.size === 0) this.stopHands();
    }
  }

  async consume(server, name, used) {
    const botcore = server.botcore != null;
    for (const u of used) {
      if (botcore) {
        const text = String(await server.value(`botcore take ${quoteName(name)} ${u.hash} 1 take belt`).catch(() => ''));
        if (/^taken [1-9]/.test(text)) continue;
      }
      if (!(await server.destroyEntity(u.id))) return false;
    }
    return true;
  }

  expand(template, caster, target, pos) {
    const quoted = quoteName(target);
    return String(template)
      .replace(/"?\{(player|username|target)\}"?/g, quoted)
      .replace(/"?\{caster\}"?/g, quoteName(caster))
      .replace(/\{x\}/g, pos ? pos[0].toFixed(3) : '0')
      .replace(/\{y\}/g, pos ? pos[1].toFixed(3) : '0')
      .replace(/\{z\}/g, pos ? pos[2].toFixed(3) : '0');
  }

  async targets(server, name, recipe) {
    if (!recipe.aoe) return { list: [name], pos: null };
    const list = await server.value('player list-detailed').catch(() => null);
    const me = Array.isArray(list) ? list.find((p) => p && String(p.username).toLowerCase() === name.toLowerCase()) : null;
    const chunk = me && me.Chunk;
    const near = Array.isArray(list) ? list.filter((p) => p && p.Chunk === chunk && isSafeName(p.username)).map((p) => p.username) : [name];
    const out = recipe.aoeCaster ? near : near.filter((n) => n.toLowerCase() !== name.toLowerCase());
    return { list: out, pos: vec(me && me.Position) };
  }

  async fire(server, name, recipe, used, { test = false } = {}) {
    const key = `${server.id}:${name.toLowerCase()}:${recipe.name}`;
    if (!test) {
      const until = this.cooldowns.get(key) || 0;
      if (until > Date.now()) {
        await server.message(name, `${recipe.name} is ready in ${Math.ceil((until - Date.now()) / 1000)} s.`, 4).catch(() => {});
        return { fired: false, why: 'cooldown' };
      }
      if (recipe.cooldown) this.cooldowns.set(key, Date.now() + recipe.cooldown * 1000);
      if (recipe.consume && !(await this.consume(server, name, used))) {
        await server.message(name, `${recipe.name} failed, the items could not be used.`, 4).catch(() => {});
        return { fired: false, why: 'consume' };
      }
    }
    const { list, pos } = await this.targets(server, name, recipe);
    const errors = [];
    const sent = [];
    const once = (t) => !/\{(player|username|target)\}/.test(t);
    for (let i = 0; i < recipe.commands.length; i += 1) {
      if (i > 0 && recipe.delay) await new Promise((r) => setTimeout(r, recipe.delay * 1000));
      const template = recipe.commands[i];
      for (const target of once(template) ? [name] : list) {
        const text = this.expand(template, name, target, pos);
        sent.push(text);
        const r = await server.run(text, { allowError: true }).catch((e) => ({ error: e.message }));
        if (r.error) errors.push(`${text}: ${String(r.error).slice(0, 120)}`);
      }
    }
    if (recipe.give) {
      for (let i = 0; i < recipe.give.count; i += 1) {
        const line = server.botcore != null ? `trade post ${quoteName(name)} ${recipe.give.hash} 1` : `spawn ${quoteName(name)} ${recipe.give.hash}`;
        sent.push(line);
        const r = await server.run(line, { allowError: true }).catch((e) => ({ error: e.message }));
        if (r.error) errors.push(`${line}: ${String(r.error).slice(0, 120)}`);
      }
    }
    if (recipe.buff) {
      for (const target of list) {
        const line = `player modify-stat ${quoteName(target)} ${recipe.buff.stat} ${recipe.buff.value} ${recipe.buff.seconds} ${recipe.buff.multiply ? 'true' : 'false'}`;
        sent.push(line);
        const r = await server.run(line, { allowError: true }).catch((e) => ({ error: e.message }));
        if (r.error) errors.push(`${line}: ${String(r.error).slice(0, 120)}`);
      }
    }
    if (recipe.text) await server.message(name, recipe.text, 6).catch(() => {});
    this.bot.logs.line(server, 'alchemy', `**${name}** used **${recipe.name}**${errors.length ? `, ${errors.length} command(s) failed: ${errors[0]}` : ''}.`);
    return { fired: true, sent, errors };
  }

  makeRecipe(server, fields) {
    const d = this.doc(server);
    d.recipes[fields.name] = fields;
    this.save(server);
    return fields;
  }

  makeHold(server, fields) {
    const d = this.doc(server);
    d.holds[fields.name] = fields;
    this.save(server);
    return fields;
  }

  remove(server, kind, name) {
    const d = this.doc(server)[kind];
    if (!own(d, name)) return false;
    delete d[name];
    this.save(server);
    return true;
  }

  async stringMatches(server, rule, id) {
    const key = `${server.id}:${id}`;
    let print = this.strings.get(key);
    if (print === undefined) {
      const text = await server.entityString(id).catch(() => null);
      if (!text) return false;
      try {
        print = blueprint(text);
      } catch {
        print = null;
      }
      if (this.strings.size > 2000) this.strings.clear();
      this.strings.set(key, print);
    }
    return print === rule.print;
  }

  spots(inv, where) {
    const out = [];
    const add = (e) => {
      if (e && e.Identifier != null) out.push({ id: Number(e.Identifier), hash: Number(e.PrefabHash) });
    };
    if (where !== 'pocket') {
      add(inv.LeftHand);
      add(inv.RightHand);
    }
    if (where !== 'hand') (inv.Belt || []).forEach(add);
    if (where === 'any') (inv.All || []).forEach(add);
    return out;
  }

  async holds(server, rule, inv) {
    for (const spot of this.spots(inv, rule.where)) {
      if (spot.hash !== rule.hash) continue;
      if (!rule.print || (await this.stringMatches(server, rule, spot.id))) return true;
    }
    return false;
  }

  async checkHolds(server, name, inv) {
    const rules = Object.values(this.doc(server).holds).filter((h) => h.on);
    for (const rule of rules) {
      const key = `${server.id}:${name.toLowerCase()}:${rule.name}`;
      const has = this.mayUse(rule, name) && (await this.holds(server, rule, inv));
      const active = this.holding.get(key);
      if (has && !active) {
        const entry = { server, name, rule: rule.name, timer: null };
        this.holding.set(key, entry);
        this.applyHold(key, entry);
        await server.message(name, rule.text || `${rule.name} is active while you carry it.`, 4).catch(() => {});
      }
      if (!has && active) {
        clearTimeout(active.timer);
        this.holding.delete(key);
      }
    }
  }

  applyHold(key, entry) {
    const { server, name } = entry;
    const rule = own(this.doc(server).holds, entry.rule);
    if (!rule || !rule.on || !server.online || !server.find(name)) {
      this.holding.delete(key);
      return;
    }
    for (const b of rule.stats) {
      server.run(`player modify-stat ${quoteName(name)} ${b.stat} ${b.value} ${BUFF_SECONDS} ${b.multiply ? 'true' : 'false'}`, { allowError: true }).catch(() => {});
    }
    entry.timer = setTimeout(() => this.applyHold(key, entry), BUFF_SECONDS * 1000);
    entry.timer.unref?.();
  }

  async sweep() {
    for (const server of this.bot.servers.values()) {
      if (!server.online || Object.values(this.doc(server).holds).every((h) => !h.on)) continue;
      for (const p of server.players()) {
        if (isSafeName(p.username)) await this.inspect(server, p.username).catch(() => {});
      }
    }
  }

  start() {
    for (const server of this.bot.servers.values()) {
      this.sync(server);
      server.on('InventoryChanged', (d) => this.changed(server, d));
      server.on('ready', () => {
        this.strings.clear();
        this.sync(server);
      });
    }
    this.sweepTimer = setInterval(() => this.sweep().catch(() => {}), SWEEP_MS);
    this.sweepTimer.unref?.();
  }

  stop() {
    this.stopHands();
    clearInterval(this.sweepTimer);
    for (const t of this.settle.values()) clearTimeout(t);
    for (const e of this.holding.values()) clearTimeout(e.timer);
  }
}

function parseSlots(text) {
  const out = [];
  for (const part of String(text).split(/[,;]+/).map((x) => x.trim()).filter(Boolean)) {
    const item = items.resolve(part);
    if (!item) throw new UserError(`No item matches "${part}". Use item codes or exact names, split by commas.`);
    out.push(item.hash);
  }
  if (out.length < 1 || out.length > 4) throw new UserError('A recipe uses 1 to 4 items, for the four front pockets.');
  return out;
}

function checkCommand(text) {
  if (/[\r\n]/.test(text)) throw new UserError('A command must be one line.');
  return text.trim();
}

Alchemy.blueprint = blueprint;
Alchemy.match = match;
Alchemy.parseSlots = parseSlots;
Alchemy.checkCommand = checkCommand;
Alchemy.STAT = STAT;
module.exports = Alchemy;
