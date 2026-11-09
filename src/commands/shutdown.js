const { SlashCommandBuilder } = require('discord.js');
const { addInt, addText } = require('../core/opts');
const { cleanText } = require('../game/text');

function who(server) {
  const n = server.players().length;
  return n ? `${n} player${n === 1 ? '' : 's'} online will be kicked.` : 'Nobody is online.';
}

function options(ctx) {
  return { seconds: ctx.opt('warning') ?? 30, reason: ctx.opt('reason') ? cleanText(ctx.opt('reason'), 100) : null };
}

module.exports = {
  data: addText(addInt(new SlashCommandBuilder().setName('shutdown').setDescription('Save the world and close the game server'), 'warning', 'Seconds of warning for players (default 30)', { required: false, min: 0, max: 300 }), 'reason', 'Shown to players with the warning', { required: false, max: 100 }),
  access: 'admin',
  public: true,
  who,
  options,

  async run(ctx) {
    const s = ctx.needOnline();
    const opts = options(ctx);
    if (!(await ctx.confirm(`Close ${s.name}?`, `${who(s)} The world saves first, and the server closes after ${opts.seconds} seconds of warning.`, { label: 'Close server' }))) return null;
    await ctx.info('Closing', `Warning players, then saving and closing ${s.name}.`);
    await ctx.bot.power.shutdown(s, opts);
    ctx.note(`${s.name}${opts.reason ? `: ${opts.reason}` : ''}`);
    return ctx.ok('Closed', `${s.name} saved and closed.${ctx.bot.power.canBoot(s) ? ' Use /boot to start it again.' : ''}`);
  },
};
