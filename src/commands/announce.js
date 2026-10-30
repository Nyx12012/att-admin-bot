const { SlashCommandBuilder } = require('discord.js');
const { addText, addInt, addName } = require('../core/opts');
const { minutes } = require('../core/ui');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('announce')
    .setDescription('Messages that repeat in game on a timer')
    .addSubcommand((s) => addInt(addInt(addText(s.setName('add').setDescription('Add a repeating message'), 'text', 'The message'), 'every', 'Minutes between showings', { min: 5, max: 1440 }), 'seconds', 'How long it stays on screen (default 8)', { required: false, min: 3, max: 30 }))
    .addSubcommand((s) => s.setName('list').setDescription('Every repeating message'))
    .addSubcommand((s) => addName(s.setName('remove').setDescription('Delete one'), 'id', 'Its id from /announce list', { max: 8 })),
  access: 'admin',

  async run(ctx) {
    const s = ctx.needServer();
    if (ctx.sub === 'add') {
      const a = ctx.bot.announce.add(s, ctx.opt('text'), ctx.opt('every'), ctx.opt('seconds') || 8);
      ctx.note(`${a.id}: ${a.text}`);
      return ctx.ok('Announcement added', `\`${a.id}\` every ${minutes(a.every)}:\n${a.text}`);
    }
    if (ctx.sub === 'remove') {
      const ok = ctx.bot.announce.remove(s, String(ctx.opt('id')).toLowerCase());
      return ok ? ctx.ok('Removed', `Announcement ${ctx.opt('id')} is gone.`) : ctx.warn('Not found', `No announcement ${ctx.opt('id')}.`);
    }
    const list = Object.values(ctx.bot.announce.doc(s));
    return ctx.info('Announcements', list.map((a) => `\`${a.id}\` every ${minutes(a.every)}: ${a.text}`).join('\n') || 'None yet.');
  },
};
