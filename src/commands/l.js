const { SlashCommandBuilder } = require('discord.js');
const targets = require('../core/targets');
const { embed } = require('../core/ui');

module.exports = {
  data: new SlashCommandBuilder().setName('l').setDescription('Number the players online, then use the number in any player option'),
  access: 'admin',
  public: true,

  async run(ctx) {
    const s = ctx.needOnline();
    const list = targets.renumber(ctx.bot, s, await s.refreshRoster());
    if (!list.length) return ctx.info(`${s.name}: nobody online`, 'Nobody is online.');
    const lines = list.map((e) => {
      const link = ctx.bot.links.ownerOf(s, e.username);
      return `**${e.n}.** ${e.username}${e.id != null ? ` (${e.id})` : ''}${link ? ` <@${link}>` : ''}`;
    });
    const card = embed('info', `${s.name}: ${list.length} online`, lines.join('\n'))
      .setFooter({ text: 'Player options take this number, the name, or an @mention of a linked member. A number stays with its player until they leave.' });
    return ctx.reply({ embeds: [card], components: [] });
  },
};
