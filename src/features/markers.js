const { chunkBounds, overworldChunk, vec, quoteName, isSafeName, distance, prefabName, UserError, CHUNK_SIZE } = require('../game/text');

const FINDER = 17262;
const CORNER = 28202;
const EDGE = 18244;
const STEP = 16;
const LIFT = 20;
const TOP = 80;
const DRIFT = 6;
const INSET = 0.5;
const FALL_MS = 3000;
const MAX_SETS = 3;
const COOLDOWN_MS = 60000;
const NEAR = 2;
const MAX_TRIES = 3;
const NAMES = { 'Player Grave': CORNER, 'Lamp Post': EDGE };

function borderPoints(chunk) {
  const b = chunkBounds(chunk);
  if (!b) return [];
  const out = [];
  for (let t = 0; t <= CHUNK_SIZE; t += STEP) {
    const corner = t === 0 || t === CHUNK_SIZE;
    const x = Math.min(Math.max(b.minX + t, b.minX + INSET), b.maxX - INSET);
    out.push({ x, z: b.minZ + INSET, prefab: corner ? CORNER : EDGE }, { x, z: b.maxZ - INSET, prefab: corner ? CORNER : EDGE });
    if (!corner) out.push({ x: b.minX + INSET, z: b.minZ + t, prefab: EDGE }, { x: b.maxX - INSET, z: b.minZ + t, prefab: EDGE });
  }
  return out;
}

function firstId(reply) {
  const rows = Array.isArray(reply.result) ? reply.result : reply.result ? [reply.result] : [];
  const id = rows[0] && rows[0].Identifier;
  return id == null ? null : Number(id);
}

class Markers {
  constructor(bot) {
    this.bot = bot;
    this.cooldown = new Map();
    this.watching = new Set();
    this.timer = null;
    this.busy = new Set();
  }

  doc(server) {
    const d = this.bot.store.get(`server-${server.id}-markers`, () => ({}));
    if (!d.sets) d.sets = [];
    return d;
  }

  save(server) {
    this.bot.store.save(`server-${server.id}-markers`);
  }

  async place(server, name, prefab, x, y, z) {
    const reply = await server.run(`spawn ${quoteName(name)} ${prefab}`);
    const id = firstId(reply);
    if (id == null) throw new UserError('The server did not say what it spawned.');
    await server.selected(async () => {
      if (!(await server.pick(id))) throw new UserError('Could not select what was spawned.');
      await server.run('select rotate exact 0,0,0');
      await server.run(`select move exact ${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`);
    }).catch(async (e) => {
      await server.destroyEntity(id).catch(() => {});
      throw e;
    });
    return id;
  }

  async ground(server, name, points, fromY) {
    if (server.botcore) {
      const heights = [];
      for (const p of points) {
        const text = String(await server.value(`botcore ground ${p.x} ${p.z} ${(fromY + TOP).toFixed(1)}`).catch(() => ''));
        const m = text.match(/^ground (-?[0-9.]+)$/);
        heights.push(m ? Number(m[1]) : fromY);
      }
      return heights;
    }
    const finders = [];
    try {
      for (const p of points) finders.push(await this.place(server, name, FINDER, p.x, fromY + LIFT, p.z));
    } catch (e) {
      for (const id of finders) await server.destroyEntity(id).catch(() => {});
      throw e;
    }
    await new Promise((r) => setTimeout(r, FALL_MS));
    const heights = [];
    for (const id of finders) {
      const info = await server.value(`select get ${id}`).catch(() => null);
      const pos = vec(info && info.Position);
      const p = points[finders.indexOf(id)];
      const drifted = !pos || Math.hypot(pos[0] - p.x, pos[2] - p.z) > DRIFT;
      heights.push(!drifted && pos[1] > fromY - LIFT * 2 && pos[1] < fromY + LIFT - 0.5 ? pos[1] : fromY);
      await server.destroyEntity(id);
    }
    return heights;
  }

  async show(server, name, { minutes = 5, by = null, force = false } = {}) {
    const key = `${server.id}:${name.toLowerCase()}`;
    if (!force && (this.cooldown.get(key) || 0) > Date.now()) throw new UserError('Wait a minute before marking another chunk.');
    const { pos, chunk: raw } = await server.position(name);
    const chunk = overworldChunk(raw);
    if (!pos || !chunk) throw new UserError(`${name} has to be outdoors in a normal chunk.`);
    const d = this.doc(server);
    const live = d.sets.filter((s) => s.until > Date.now());
    if (live.some((s) => s.chunk === chunk)) throw new UserError(`Chunk ${chunk} is already marked.`);
    if (!force && live.some((s) => s.by.toLowerCase() === name.toLowerCase())) throw new UserError('You already have a marked chunk. Use /chunk hide first.');
    if (live.length >= MAX_SETS) throw new UserError(`${MAX_SETS} chunks are already marked. Wait for them to clear, or use /chunk hide.`);
    if (this.busy.has(server.id)) throw new UserError('Another chunk is being marked right now.');
    this.busy.add(server.id);
    try {
      this.cooldown.set(key, Date.now() + COOLDOWN_MS);
      const points = borderPoints(chunk);
      const heights = await this.ground(server, name, points, pos[1]);
      const set = { id: `${chunk}-${Date.now()}`, chunk, by: by || name, until: Date.now() + minutes * 60000, at: Date.now(), entities: [] };
      d.sets.push(set);
      for (let i = 0; i < points.length; i += 1) {
        const p = points[i];
        const id = await this.place(server, name, p.prefab, p.x, heights[i], p.z);
        set.entities.push({ id, hash: p.prefab, pos: [p.x, heights[i], p.z] });
        this.save(server);
      }
      return set;
    } finally {
      this.busy.delete(server.id);
    }
  }

  async removeSet(server, set) {
    const left = [];
    for (const e of set.entities) {
      const info = await server.value(`select get ${e.id}`).catch(() => null);
      const pos = vec(info && info.Position);
      if (info && Number(info.PrefabHash) === e.hash && pos && distance(pos, e.pos) <= NEAR) {
        if (!(await server.destroyEntity(e.id))) left.push(e);
      } else {
        left.push(e);
      }
    }
    set.entities = left.length ? await this.removeByPlace(server, left) : [];
    this.save(server);
    return set.entities.length === 0;
  }

  async removeByPlace(server, wanted) {
    const anchor = server.players().map((p) => p.username).find(isSafeName);
    if (!anchor) return wanted;
    const all = await server.value(`select find ${quoteName(anchor)} 100000`, { timeout: 60000 }).catch(() => null);
    if (!Array.isArray(all)) return wanted;
    const left = [...wanted];
    for (const e of all) {
      const hash = NAMES[prefabName(e.Name)];
      if (!hash || left.length === 0) continue;
      const info = await server.value(`select get ${Number(e.Identifier)}`).catch(() => null);
      const pos = vec(info && info.Position);
      if (!pos) continue;
      const i = left.findIndex((w) => w.hash === hash && distance(pos, w.pos) <= NEAR);
      if (i < 0) continue;
      if (await server.destroyEntity(Number(e.Identifier))) left.splice(i, 1);
    }
    return left;
  }

  async hide(server, { name = null, all = false } = {}) {
    const d = this.doc(server);
    let chunk = null;
    if (name) {
      const p = await server.position(name).catch(() => null);
      chunk = p && overworldChunk(p.chunk);
    }
    const mine = d.sets.filter((s) => all || (name && (s.by.toLowerCase() === name.toLowerCase() || s.chunk === chunk)));
    for (const s of mine) s.until = 0;
    this.save(server);
    await this.tickServer(server);
    return { asked: mine.length, left: this.doc(server).sets.length };
  }

  async tickServer(server) {
    if (!server.online || server.roster.size === 0) return;
    const d = this.doc(server);
    const due = d.sets.filter((s) => s.until <= Date.now());
    if (due.length === 0) return;
    const list = await server.value('player list-detailed').catch(() => null);
    const near = new Set(Array.isArray(list) ? list.map((p) => overworldChunk(p && p.Chunk)).filter(Boolean) : []);
    for (const set of due) {
      if (!near.has(set.chunk)) continue;
      if (await this.removeSet(server, set)) {
        set.gone = true;
        continue;
      }
      set.tries = (set.tries || 0) + 1;
      if (set.tries >= MAX_TRIES) {
        set.gone = true;
        this.bot.logs.line(server, 'plots', `${set.entities.length} marker(s) in chunk ${set.chunk} could not be found to remove. Someone may have moved them, /despawn or /chunks can clear them.`);
      }
    }
    d.sets = d.sets.filter((s) => !s.gone);
    this.save(server);
  }

  start() {
    for (const server of this.bot.servers.values()) {
      server.on('PlayerMovedChunk', (d) => {
        const name = d.player && d.player.username;
        if (!name || !d.newChunk || !this.watching.has(`${server.id}:${name.toLowerCase()}`)) return;
        const chunk = overworldChunk(d.newChunk);
        const plot = chunk ? this.bot.plots.at(server, chunk) : null;
        const text = chunk ? `Chunk ${chunk}${plot ? `, ${plot.owner}'s plot "${plot.name}"` : ', no plot'}` : 'Indoors, plots do not apply here';
        server.message(name, text, 4).catch(() => {});
      });
    }
    this.timer = setInterval(() => {
      for (const server of this.bot.servers.values()) this.tickServer(server).catch((e) => console.warn(`[markers] ${e.message}`));
    }, 30000);
    this.timer.unref?.();
  }

  stop() {
    clearInterval(this.timer);
  }
}

Markers.borderPoints = borderPoints;
module.exports = Markers;
