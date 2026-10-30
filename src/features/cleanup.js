const items = require('../core/items');
const { squash, prefabName, isSafeName, safeKey, own, UserError } = require('../game/text');
const { embed } = require('../core/ui');

const PRESETS = {
  spriggull: {
    label: 'Spriggull drops: feathers, raw drumsticks, bones',
    items: [18734, 7918, 25446, 36248, 43430, 5972, 24406, 24072, 50608, 12492],
  },
  rocks: {
    label: 'Loose rocks: stone, sandstone, flint',
    items: [61670, 55930, 39484],
  },
  cave: {
    label: 'Cave leftovers: stone, flint, blue crystal shards, turabada arms',
    items: [61670, 39484, 7092, 15584],
  },
  trees: {
    label: 'Tree leftovers: sticks and wooden arrow shafts',
    items: [61674, 29772],
  },
  mushrooms: {
    label: 'Half eaten mushrooms and gourd canteens',
    items: [38360, 54182, 29032, 58270, 48460, 41834],
  },
  rusty: {
    label: 'Rusty tools from loot',
    items: [4412, 40366, 29296, 63156, 36126, 46874, 59586, 20684, 44824, 33230],
  },
  scraps: {
    label: 'Apple cores',
    items: [902, 31614, 15500, 50484],
  },
};

const DEFAULT_EVERY = 30;
const BATCH = 25;

class Cleanup {
  constructor(bot) {
    this.bot = bot;
    this.running = new Set();
    this.timer = null;
  }

  doc(server) {
    const d = this.bot.store.get(`server-${server.id}-cleanup`, () => ({}));
    if (d.enabled == null) d.enabled = true;
    if (!d.warning) d.warning = { on: false, seconds: 60 };
    if (!d.rules) d.rules = {};
    return d;
  }

  save(server) {
    this.bot.store.save(`server-${server.id}-cleanup`);
  }

  rules(server) {
    return this.doc(server).rules;
  }

  rule(server, name) {
    const r = own(this.rules(server), String(name).toLowerCase());
    if (!r) throw new UserError(`There is no cleanup rule called "${name}". See /cleanup list.`);
    return r;
  }

  addRule(server, name, hashes, { every = DEFAULT_EVERY, min = 0, preset = null } = {}) {
    const key = safeKey(name);
    const known = [...new Set(hashes.map(Number))].filter((h) => Number.isFinite(h) && h > 0);
    if (known.length === 0) throw new UserError('A rule needs at least one item.');
    const d = this.doc(server);
    const old = own(d.rules, key);
    d.rules[key] = {
      name: key,
      items: known,
      every: Math.max(5, Math.min(1440, Math.round(every))),
      min: Math.max(0, Math.round(min)),
      mode: old ? old.mode : 'preview',
      on: true,
      preset,
      last: old ? old.last : 0,
      result: old ? old.result : null,
    };
    this.save(server);
    return d.rules[key];
  }

  removeRule(server, name) {
    const d = this.doc(server);
    const key = String(name).toLowerCase();
    if (!own(d.rules, key)) return false;
    delete d.rules[key];
    this.save(server);
    return true;
  }

  anchor(server) {
    return server.players().map((p) => p.username).filter(isSafeName);
  }

  async scan(server, hashes) {
    const wanted = new Map();
    for (const h of hashes) {
      const item = items.byHash(h);
      if (item) wanted.set(item.key, item.hash);
    }
    const hashSet = new Set(hashes.map(Number));
    const counts = new Map(hashes.map((h) => [Number(h), { hash: Number(h), name: (items.byHash(h) || {}).name || `Prefab ${h}`, loose: 0, held: 0, ids: [] }]));
    const anchors = this.anchor(server);
    if (anchors.length === 0) return { counts, total: 0, nobody: true };
    let all = null;
    let lastError = null;
    for (const name of anchors) {
      try {
        const r = await server.value(`select find "${name}" 100000`, { timeout: 60000 });
        if (Array.isArray(r)) {
          all = r;
          break;
        }
      } catch (e) {
        lastError = e;
      }
    }
    if (!all) throw lastError || new UserError('Could not list the loaded items.');
    const candidates = all.filter((e) => wanted.has(squash(prefabName(e.Name))));
    for (let i = 0; i < candidates.length; i += BATCH) {
      const slice = candidates.slice(i, i + BATCH);
      const infos = await Promise.all(slice.map((e) => server.value(`select get ${Number(e.Identifier)}`).catch(() => null)));
      for (const info of infos) {
        if (!info || typeof info !== 'object' || !hashSet.has(Number(info.PrefabHash))) continue;
        const c = counts.get(Number(info.PrefabHash));
        if (Number(info.ChunkingParent) === 0) {
          c.loose += 1;
          c.ids.push(Number(info.Identifier));
        } else {
          c.held += 1;
        }
      }
    }
    let total = 0;
    for (const c of counts.values()) total += c.loose;
    return { counts, total, nobody: false, scanned: all.length };
  }

  async destroy(server, scan) {
    let removed = 0;
    let fallback = false;
    for (const c of scan.counts.values()) {
      if (c.loose === 0) continue;
      if (!fallback) {
        const r = await server.run(`wacky destroy-free ${c.hash}`, { allowError: true });
        if (!r.error) {
          removed += c.loose;
          continue;
        }
        if (!/not found/i.test(r.error)) throw new UserError(`The server refused the cleanup of ${c.name}: ${r.error}`);
        fallback = true;
      }
      for (const id of c.ids) {
        const info = await server.value(`select get ${id}`).catch(() => null);
        if (!info || Number(info.ChunkingParent) !== 0 || Number(info.PrefabHash) !== c.hash) continue;
        const r = await server.run(`wacky destroy ${id}`, { allowError: true });
        if (!r.error) removed += 1;
      }
    }
    return { removed, fallback };
  }

  summary(scan, verb) {
    const rows = [...scan.counts.values()].filter((c) => c.loose > 0).sort((a, b) => b.loose - a.loose);
    if (rows.length === 0) return 'Nothing on the ground.';
    return rows.map((c) => `${c.loose}  ${c.name}`).join('\n') + `\n**${scan.total}** ${verb}`;
  }

  names(hashes) {
    const list = hashes.map((h) => (items.byHash(h) || {}).name || `Prefab ${h}`);
    return list.length > 4 ? `${list.slice(0, 4).join(', ')} and ${list.length - 4} more` : list.join(', ');
  }

  async lock(server, fn) {
    if (this.running.has(server.id)) throw new UserError('A cleanup is already running on this server. Try again in a minute.');
    this.running.add(server.id);
    try {
      return await fn();
    } finally {
      this.running.delete(server.id);
    }
  }

  async warn(server, hashes) {
    const w = this.doc(server).warning;
    if (!w.on || server.roster.size === 0) return;
    await server.broadcast(`Ground cleanup in ${w.seconds} seconds: ${this.names(hashes)}. Pick up what you want to keep.`, 10).catch(() => {});
    await new Promise((r) => setTimeout(r, w.seconds * 1000));
  }

  async runRule(server, rule, { preview = false, auto = false } = {}) {
    return this.lock(server, async () => {
      const dry = preview || rule.mode !== 'live';
      const scan = await this.scan(server, rule.items);
      const result = { at: Date.now(), found: scan.total, removed: 0, dry, nobody: scan.nobody, below: false };
      const floor = auto ? rule.min : 0;
      if (!scan.nobody && !dry && scan.total > floor) {
        await this.warn(server, rule.items);
        const again = this.doc(server).warning.on ? await this.scan(server, rule.items) : scan;
        const done = await this.destroy(server, again);
        result.found = again.total;
        result.removed = done.removed;
        result.fallback = done.fallback;
        result.detail = this.summary(again, 'removed');
      } else {
        result.below = !dry && !scan.nobody && scan.total <= floor && scan.total > 0;
        result.detail = this.summary(scan, dry ? 'would be removed' : 'on the ground');
      }
      if (auto || !preview) {
        rule.last = result.at;
        rule.result = { at: result.at, found: result.found, removed: result.removed, dry: result.dry };
        this.save(server);
      }
      if (auto) this.report(server, rule, result);
      return result;
    });
  }

  async sweepItems(server, hashes, { preview = false } = {}) {
    return this.lock(server, async () => {
      const scan = await this.scan(server, hashes);
      if (preview || scan.nobody || scan.total === 0) return { scan, removed: 0 };
      const done = await this.destroy(server, scan);
      return { scan, removed: done.removed, fallback: done.fallback };
    });
  }

  report(server, rule, result) {
    if (result.nobody || result.found === 0) return;
    const channel = this.bot.channelFor(server, 'cleanup');
    const title = result.dry ? `Cleanup preview: ${rule.name}` : result.below ? `Cleanup skipped: ${rule.name}` : `Cleanup: ${rule.name}`;
    let text = result.detail;
    if (result.dry) text += '\nThis rule is in preview mode. Switch it on with `/cleanup mode`.';
    if (result.below) text = `Only ${result.found} on the ground, the rule waits for more than ${rule.min}.`;
    if (channel) {
      this.bot.post(channel, { embeds: [embed(result.dry || result.below ? 'muted' : 'ok', title, text).setFooter({ text: server.name }).setTimestamp()] });
    } else {
      this.bot.logs.line(server, 'cleanup', `${title}: ${result.dry ? `${result.found} would be removed` : result.below ? `${result.found} found, waiting` : `${result.removed} removed`}.`);
    }
  }

  async tickServer(server) {
    if (!server.online || this.running.has(server.id) || server.roster.size === 0) return;
    const d = this.doc(server);
    if (!d.enabled) return;
    const due = Object.values(d.rules).find((rule) => rule.on && Date.now() - (rule.last || 0) >= rule.every * 60000);
    if (!due) return;
    try {
      await this.runRule(server, due, { auto: true });
    } catch (e) {
      due.last = Date.now();
      this.save(server);
      console.warn(`[cleanup] ${server.id}/${due.name}: ${e.message}`);
    }
  }

  async tick() {
    await Promise.all([...this.bot.servers.values()].map((s) => this.tickServer(s)));
  }

  start() {
    this.timer = setInterval(() => this.tick().catch((e) => console.warn(`[cleanup] ${e.message}`)), 30000);
    this.timer.unref?.();
  }

  stop() {
    clearInterval(this.timer);
  }
}

Cleanup.PRESETS = PRESETS;
module.exports = Cleanup;
