const { SlashCommandBuilder } = require('discord.js');
const { addNumber } = require('../core/opts');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('time')
    .setDescription('Change the time of day')
    .addSubcommand((s) => s.setName('day').setDescription('Jump to morning'))
    .addSubcommand((s) => s.setName('night').setDescription('Jump to night'))
    .addSubcommand((s) => addNumber(s.setName('set').setDescription('Jump to an hour of the day'), 'hour', '0 to 24, like 13.5 for half past one', { min: 0, max: 24 })),
  access: 'admin',

  async run(ctx) {
    const s = ctx.needOnline();
    const value = ctx.sub === 'set' ? String(Number(ctx.opt('hour')).toFixed(2)) : ctx.sub;
    await s.run(`time set ${value}`);
    ctx.note(value);
    return ctx.ok('Time changed', ctx.sub === 'set' ? `It is now ${value} o'clock in game.` : `It is now ${ctx.sub} in game.`);
  },
};
