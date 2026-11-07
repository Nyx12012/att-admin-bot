const { SlashCommandBuilder } = require('discord.js');
const { addName } = require('../core/opts');
const { UserError, chunkName, prefabName } = require('../game/text');
const { code, list } = require('../core/ui');

function chunk(s) {
  return addName(s, 'chunk', 'Chunk like 21-34', { max: 40 });
}

function read(ctx) {
  const c = chunkName(ctx.opt('chunk'));
  if (!/^\d+-\d+$/.test(c)) throw new UserError('Write the chunk like 21-34.');
  return `Chunk ${c}`;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('chunks')
    .setDescription('Look into a chunk, or put it back to how it started')
    .addSubcommand((s) => chunk(s.setName('entities').setDescription('What is saved in a chunk')))
    .addSubcommand((s) => chunk(s.setName('wipe').setDescription('Reset a chunk: everything players left in it is lost'))),
  access: { entities: 'admin', wipe: 'owner', '*': 'admin' },

  async run(ctx) {
    const s = ctx.needOnline();
    const c = read(ctx);
    if (ctx.sub === 'entities') {
      const r = await s.value(`chunks entities "${c}"`, { timeout: 60000 });
      if (!Array.isArray(r)) return ctx.info(c, String(r || 'Nothing saved there.').slice(0, 3800));
      const counts = new Map();
      for (const e of r) {
        const n = String(e && e.Name);
        if (n.endsWith('(Clone)')) counts.set(prefabName(n), (counts.get(prefabName(n)) || 0) + 1);
      }
      const rows = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([n, k]) => `${k} x ${n}`);
      return ctx.info(c, list(rows, 'Nothing saved there.'));
    }
    if (!(await ctx.confirm(`Reset ${c}?`, 'The chunk goes back to how the world started. Everything players built or left in it is lost. This cannot be undone.', { label: 'Reset' }))) return null;
    await s.run(`chunks wipe "${c}"`, { timeout: 60000 });
    ctx.note(c);
    return ctx.ok('Chunk reset', `${code(c)} goes back to how it started when it next loads.`);
  },
};
