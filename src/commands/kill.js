const { SlashCommandBuilder } = require('discord.js');
const { addPlayer } = require('../core/opts');

module.exports = {
  data: addPlayer(new SlashCommandBuilder().setName('kill').setDescription('Down a player (they bleed out unless revived)')),
  access: 'admin',

  async run(ctx) {
    const s = ctx.needOnline();
    const name = ctx.player();
    await s.run(`player kill "${name}"`);
    ctx.note(name);
    return ctx.ok('Done', `${name} was downed.`);
  },
};
