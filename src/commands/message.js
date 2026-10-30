const { SlashCommandBuilder } = require('discord.js');
const { addPlayer, addText, addInt } = require('../core/opts');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('message')
    .setDescription('Show a message on screen in game')
    .addSubcommand((s) => addInt(addText(addPlayer(s.setName('player').setDescription('To one player')), 'text', 'The message'), 'seconds', 'How long it stays (default 8)', { required: false, min: 2, max: 60 }))
    .addSubcommand((s) => addInt(addText(s.setName('all').setDescription('To everyone online'), 'text', 'The message'), 'seconds', 'How long it stays (default 8)', { required: false, min: 2, max: 60 })),
  access: 'admin',

  async run(ctx) {
    const s = ctx.needOnline();
    const text = ctx.opt('text');
    const seconds = ctx.opt('seconds') || 8;
    if (ctx.sub === 'all') {
      if (s.roster.size === 0) return ctx.warn('Nobody online', 'There is nobody to show it to.');
      await s.broadcast(text, seconds);
      ctx.note(text);
      return ctx.ok('Sent to everyone', text);
    }
    const name = ctx.player();
    await s.message(name, text, seconds);
    ctx.note(`${name}: ${text}`);
    return ctx.ok(`Sent to ${name}`, text);
  },
};
