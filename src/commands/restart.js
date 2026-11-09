const { SlashCommandBuilder } = require('discord.js');
const { addInt, addText } = require('../core/opts');
const { who, options } = require('./shutdown');

module.exports = {
  data: addText(addInt(new SlashCommandBuilder().setName('restart').setDescription('Save the world, close the game server and start it again'), 'warning', 'Seconds of warning for players (default 30)', { required: false, min: 0, max: 300 }), 'reason', 'Shown to players with the warning', { required: false, max: 100 }),
  access: 'admin',
  public: true,

  async run(ctx) {
    const s = ctx.needOnline();
    ctx.bot.power.needPlan(s);
    const opts = options(ctx);
    if (!(await ctx.confirm(`Restart ${s.name}?`, `${who(s)} The world saves first, and the restart comes after ${opts.seconds} seconds of warning.`, { label: 'Restart server' }))) return null;
    await ctx.info('Restarting', `Warning players, then saving and closing ${s.name}.`);
    const r = await ctx.bot.power.restart(s, opts);
    ctx.note(`${s.name}${opts.reason ? `: ${opts.reason}` : ''}`);
    return ctx.ok('Restarting', `${s.name} saved, closed${r.forced ? ' (the game had to be ended after 90 seconds)' : ''} and is starting again. Players can join in a few minutes.`);
  },
};
