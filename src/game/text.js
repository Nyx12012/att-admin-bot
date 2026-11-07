const SAFE_NAME = /^[A-Za-z0-9 _.\-]{1,32}$/;

function isSafeName(name) {
  return typeof name === 'string' && SAFE_NAME.test(name) && name.trim() === name;
}

function quoteName(name) {
  if (!isSafeName(name)) throw new UserError(`"${String(name).slice(0, 40)}" is not a valid player name.`);
  return `"${name}"`;
}

function cleanText(text, max = 200) {
  const out = [...String(text ?? '')].filter((c) => {
    const code = c.codePointAt(0);
    return code >= 0x20 && code !== 0x7f && c !== '"' && c !== '\\';
  }).join('').replace(/\s+/g, ' ').trim();
  return out.slice(0, max);
}

function quoteText(text, max) {
  const clean = cleanText(text, max);
  if (!clean) throw new UserError('That message is empty once quotes and backslashes are removed.');
  return `"${clean}"`;
}

function prefabName(name) {
  return String(name ?? '').replace(/^\d+\s*-\s*/, '').replace(/\(Clone\)$/, '').trim();
}

function squash(name) {
  return prefabName(name).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function vec(v) {
  if (!Array.isArray(v) || v.length < 3) return null;
  const n = v.slice(0, 3).map(Number);
  return n.every(Number.isFinite) ? n : null;
}

function vecText(v) {
  return v.map((n) => n.toFixed(3)).join(',');
}

function chunkName(raw) {
  const m = String(raw ?? '').match(/(\d+-\d+)/);
  return m ? m[1] : String(raw ?? '').replace(/[()]/g, '').replace(/Chunk/g, '').trim();
}

function overworldChunk(raw) {
  const m = String(raw ?? '').match(/^\(?\s*(?:Chunk\s+)*(\d+-\d+)\s*\)?$/);
  return m ? m[1] : null;
}

const CHUNK_SIZE = 64;
const CHUNK_ORIGIN = -2048;

function chunkAt(pos) {
  return `${Math.floor((pos[0] - CHUNK_ORIGIN) / CHUNK_SIZE)}-${Math.floor((pos[2] - CHUNK_ORIGIN) / CHUNK_SIZE)}`;
}

function chunkBounds(name) {
  const m = String(name).match(/^(\d+)-(\d+)$/);
  if (!m) return null;
  const minX = CHUNK_ORIGIN + Number(m[1]) * CHUNK_SIZE;
  const minZ = CHUNK_ORIGIN + Number(m[2]) * CHUNK_SIZE;
  return { minX, minZ, maxX: minX + CHUNK_SIZE, maxZ: minZ + CHUNK_SIZE };
}

function distance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

class UserError extends Error {}

const RESERVED = new Set(['__proto__', 'constructor', 'prototype', 'hasownproperty', 'tostring', 'valueof']);

function safeKey(raw) {
  const key = String(raw ?? '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32);
  if (!key) throw new UserError('Names use letters, digits, _ or -.');
  if (RESERVED.has(key)) throw new UserError(`"${key}" cannot be used as a name.`);
  return key;
}

function own(obj, key) {
  return obj && Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : undefined;
}

module.exports = { isSafeName, quoteName, cleanText, quoteText, prefabName, squash, vec, vecText, chunkName, overworldChunk, chunkAt, chunkBounds, distance, CHUNK_SIZE, safeKey, own, UserError, RESERVED };
