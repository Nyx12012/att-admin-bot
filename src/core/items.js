const path = require('path');
const { squash } = require('../game/text');

const raw = require(path.join(__dirname, '..', '..', 'data', 'items.json'));

const ITEMS = raw.map((e) => ({ hash: e.h, name: e.n, pickup: Boolean(e.p), spawn: Boolean(e.s), material: Boolean(e.m), key: squash(e.n) }));
const BY_HASH = new Map(ITEMS.map((i) => [i.hash, i]));
const BY_KEY = new Map();
for (const i of ITEMS) if (!BY_KEY.has(i.key)) BY_KEY.set(i.key, i);

function byHash(hash) {
  return BY_HASH.get(Number(hash)) || null;
}

function resolve(input) {
  if (input == null) return null;
  const s = String(input).trim();
  if (/^\d+$/.test(s)) return byHash(s) || { hash: Number(s), name: `Prefab ${s}`, pickup: false, spawn: true, key: s, unknown: true };
  return BY_KEY.get(squash(s)) || null;
}

function search(query, { pickup = false, spawn = false, limit = 25 } = {}) {
  const q = squash(query || '');
  const pool = ITEMS.filter((i) => (!pickup || i.pickup) && (!spawn || i.spawn));
  if (!q) return pool.filter((i) => i.pickup).slice(0, limit);
  const starts = [];
  const contains = [];
  for (const i of pool) {
    if (i.key.startsWith(q)) starts.push(i);
    else if (i.key.includes(q) || String(i.hash) === q) contains.push(i);
  }
  const byPickup = (a, b) => Number(b.pickup) - Number(a.pickup);
  return starts.sort(byPickup).concat(contains.sort(byPickup)).slice(0, limit);
}

module.exports = { ITEMS, byHash, resolve, search };
