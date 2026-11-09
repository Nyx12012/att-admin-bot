const { UserError } = require('../game/text');

const MENTION = /^<@!?(\d{5,25})>$/;

function doc(bot, server) {
  return bot.store.get(`server-${server.id}-numbers`, {});
}

function numbered(bot, server) {
  return Array.isArray(doc(bot, server).list) ? doc(bot, server).list : [];
}

function renumber(bot, server, players) {
  return bot.store.update(`server-${server.id}-numbers`, {}, (d) => {
    const old = new Map((Array.isArray(d.list) ? d.list : []).map((e) => [String(e.username).toLowerCase(), e.n]));
    const used = new Set();
    const out = [];
    const fresh = [];
    for (const p of players) {
      const n = old.get(String(p.username).toLowerCase());
      if (n && !used.has(n)) {
        used.add(n);
        out.push({ n, username: p.username, id: p.id ?? null });
      } else fresh.push(p);
    }
    let next = 1;
    for (const p of fresh) {
      while (used.has(next)) next += 1;
      used.add(next);
      out.push({ n: next, username: p.username, id: p.id ?? null });
    }
    out.sort((a, b) => a.n - b.n);
    d.list = out;
    d.at = Date.now();
    return out;
  });
}

function numberOf(bot, server, username) {
  const lower = String(username).toLowerCase();
  const hit = numbered(bot, server).find((e) => String(e.username).toLowerCase() === lower);
  return hit ? hit.n : null;
}

function resolve(bot, server, value) {
  const text = String(value ?? '').trim();
  if (/^\d{1,4}$/.test(text)) {
    const n = Number(text);
    const hit = numbered(bot, server).find((e) => e.n === n);
    if (hit) return { username: hit.username, via: 'number', n };
    if (server.roster && server.roster.has(text.toLowerCase())) return { username: text, via: 'name' };
    throw new UserError(`No player has number ${n}. Use /l to number the players online.`);
  }
  if (/^<@&\d+>$/.test(text)) throw new UserError('That is a role. Pick a player, a number from /l or a member who used /link.');
  const m = text.match(MENTION);
  if (m) {
    const link = bot.links.of(server, m[1]);
    if (!link) throw new UserError(`<@${m[1]}> has not linked a player on this server. They can use /link start.`);
    return { username: link.username, via: 'mention', discordId: m[1] };
  }
  return { username: text, via: 'name' };
}

function choices(bot, server, query) {
  const q = String(query || '').trim().toLowerCase();
  const nums = new Map(numbered(bot, server).map((e) => [String(e.username).toLowerCase(), e.n]));
  const m = q.match(MENTION);
  const linked = m ? bot.links.of(server, m[1]) : null;
  const rows = server.players().map((p) => ({ p, n: nums.get(p.username.toLowerCase()) ?? null }));
  const score = ({ p, n }) => {
    const name = p.username.toLowerCase();
    if (linked) return linked.username.toLowerCase() === name ? 0 : -1;
    if (/^\d+$/.test(q) && n != null && String(n) === q) return 0;
    if (/^\d+$/.test(q) && n != null && String(n).startsWith(q)) return 1;
    if (name.startsWith(q)) return 2;
    if (name.includes(q)) return 3;
    return -1;
  };
  return rows
    .map((r) => ({ ...r, s: score(r) }))
    .filter((r) => r.s >= 0)
    .sort((a, b) => a.s - b.s || (a.n ?? 9999) - (b.n ?? 9999) || a.p.username.localeCompare(b.p.username))
    .map(({ p, n }) => ({ name: n != null ? `${n}. ${p.username}` : p.username, value: p.username }));
}

module.exports = { resolve, renumber, numbered, numberOf, choices };
