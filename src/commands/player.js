const { SlashCommandBuilder } = require('discord.js');
const { addPlayer } = require('../core/opts');
const { prefabName, vec } = require('../game/text');
const { ago } = require('../core/ui');

function itemName(e) {
  return e && e.Name ? prefabName(e.Name) : null;
}

function inventoryFields(inv) {
  const fields = [];
  fields.push(['Left hand', itemName(inv.LeftHand) || 'empty', true]);
  fields.push(['Right hand', itemName(inv.RightHand) || 'empty', true]);
  const belt = (inv.Belt || []).map((e, i) => `${i + 1}. ${itemName(e) || 'empty'}`);
  if (belt.length) fields.push(['Belt', belt.join('\n'), true]);
  const back = (inv.Back || []).map((e) => itemName(e)).filter(Boolean);
  fields.push(['Back', back.join(', ') || 'empty', true]);
  const counts = new Map();
  for (const e of inv.All || []) {
    const n = itemName(e);
    if (n) counts.set(n, (counts.get(n) || 0) + 1);
  }
  const all = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([n, c]) => `${c} x ${n}`);
  fields.push(['Everything carried', all.join('\n') || 'nothing', false]);
  return fields;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('player')
    .setDescription('Look up an online player')
    .addSubcommand((s) => addPlayer(s.setName('info').setDescription('Position, chunk, health and link')))
    .addSubcommand((s) => addPlayer(s.setName('inventory').setDescription('What they are carrying')))
    .addSubcommand((s) => addPlayer(s.setName('stats').setDescription('Every stat with min and max'))),
  access: 'admin',

  async run(ctx) {
    const s = ctx.needOnline();
    const name = ctx.player();
    if (ctx.sub === 'inventory') {
      const r = await s.value(`player inventory "${name}"`);
      const inv = Array.isArray(r) ? r[0] : r;
      if (!inv || typeof inv !== 'object') return ctx.warn('No inventory', `The server returned nothing for ${name}.`);
      return ctx.info(`${name}: inventory`, null, inventoryFields(inv));
    }
    if (ctx.sub === 'stats') {
      const stats = await s.stats(name);
      const lines = stats.map((st) => `\`${st.Name}\` ${Number(st.Value).toFixed(2)} (${Number(st.Min)} to ${Number(st.Max)})`);
      return ctx.info(`${name}: stats`, lines.join('\n') || 'No stats returned.');
    }
    const d = await s.detailed(name);
    const p = s.find(name);
    const pos = vec(d && d.Position);
    const health = await s.value(`player check-stat "${name}" health`).catch(() => null);
    const link = ctx.bot.links.ownerOf(s, name);
    const plot = d && d.Chunk ? ctx.bot.plots.at(s, d.Chunk) : null;
    return ctx.info(name, null, [
      ['Id', String(d && d.id != null ? d.id : (p && p.id) || 'unknown'), true],
      ['Online for', p ? ago(p.since) : 'unknown', true],
      ['Discord', link ? `<@${link}>` : 'not linked', true],
      ['Position', pos ? pos.map((n) => n.toFixed(1)).join(', ') : 'unknown', true],
      ['Chunk', d && d.Chunk ? String(d.Chunk).replace(/[()]/g, '').replace('Chunk Chunk', 'Chunk') : 'unknown', true],
      ['Plot', plot ? `${plot.name} (${plot.owner})` : 'none', true],
      ['Health', health && health.Value != null ? String(health.Value) : 'unknown', true],
    ]);
  },
};
