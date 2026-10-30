const { SlashCommandBuilder } = require('discord.js');
const { ago } = require('../core/ui');

module.exports = {
  data: new SlashCommandBuilder().setName('players').setDescription('Who is online right now'),
  access: 'everyone',
  public: true,

  async run(ctx) {
    const s = ctx.needOnline();
    const list = await s.refreshRoster();
    const lines = s.players().map((p) => {
      const link = ctx.bot.links.ownerOf(s, p.username);
      return `**${p.username}**${link ? ` (<@${link}>)` : ''}  ${ago(p.since)}`;
    });
    return ctx.info(`${s.name}: ${list.length} online`, lines.length ? lines.join('\n') : 'Nobody is online.');
  },
};
