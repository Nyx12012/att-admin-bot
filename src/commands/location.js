const { SlashCommandBuilder } = require('discord.js');
const { addPlayer, addName } = require('../core/opts');
const { UserError, safeKey, own } = require('../game/text');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('location')
    .setDescription('Saved spots to teleport players to')
    .addSubcommand((s) => addPlayer(addName(s.setName('save').setDescription('Save where a player is standing'), 'name', 'Name for the spot'), { description: 'Player standing at the spot' }))
    .addSubcommand((s) => s.setName('list').setDescription('Every saved spot'))
    .addSubcommand((s) => addName(s.setName('remove').setDescription('Delete a saved spot'), 'location', 'The spot', { auto: true })),
  access: 'admin',

  async run(ctx) {
    const s = ctx.needServer();
    const locs = ctx.data('locations', {});
    if (ctx.sub === 'list') {
      const lines = Object.entries(locs).map(([k, l]) => `**${k}** ${l.pos.map((n) => n.toFixed(1)).join(', ')} (chunk ${l.chunk || '?'})`);
      return ctx.info('Saved locations', lines.join('\n') || 'None yet. Stand somewhere in game and use /location save.');
    }
    if (ctx.sub === 'remove') {
      const key = String(ctx.opt('location')).toLowerCase();
      if (!own(locs, key)) throw new UserError(`No location called "${key}".`);
      delete locs[key];
      ctx.save('locations');
      return ctx.ok('Removed', `Location ${key} is gone.`);
    }
    ctx.needOnline();
    const key = safeKey(ctx.opt('name'));
    const name = ctx.player();
    const { pos, chunk } = await s.position(name);
    if (!pos) throw new UserError(`Could not read where ${name} is.`);
    locs[key] = { pos, chunk, by: ctx.user.tag, at: Date.now() };
    ctx.save('locations');
    ctx.note(`${key} at ${pos.join(',')}`);
    return ctx.ok('Location saved', `**${key}** = ${pos.map((n) => n.toFixed(1)).join(', ')} (where ${name} stands).`);
  },
};
