const { SlashCommandBuilder } = require('discord.js');
const { addPlayer, addBool } = require('../core/opts');

module.exports = {
  data: addBool(addPlayer(new SlashCommandBuilder().setName('heal').setDescription('Fill health and clear poison and nightmare (does not revive a downed player)')), 'food', 'Also fill hunger', { required: false }),
  access: 'admin',

  async run(ctx) {
    const s = ctx.needOnline();
    const name = ctx.player();
    const done = await s.heal(name, Boolean(ctx.opt('food')));
    ctx.note(`${name}: ${done.join(', ') || 'already fine'}`);
    return ctx.ok(`${name} healed`, done.length ? done.join('\n') : 'They were already at full health.');
  },
};
