const { SlashCommandBuilder } = require('discord.js');
const { addPlayer, addBool } = require('../core/opts');

module.exports = {
  data: addBool(addPlayer(new SlashCommandBuilder().setName('godmode').setDescription('Make a player take no damage')), 'on', 'On or off'),
  access: 'admin',

  async run(ctx) {
    const s = ctx.needOnline();
    const name = ctx.player();
    const on = ctx.opt('on');
    await s.run(`player god-mode "${name}" ${on ? 'true' : 'false'}`);
    ctx.note(`${name} ${on}`);
    return ctx.ok('God mode', `${name}: **${on ? 'on' : 'off'}**.`);
  },
};
