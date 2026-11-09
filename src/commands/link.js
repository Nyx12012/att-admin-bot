const { SlashCommandBuilder } = require('discord.js');
const { addPlayer, addText } = require('../core/opts');
const { UserError } = require('../game/text');
const { list } = require('../core/ui');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('link')
    .setDescription('Link your Discord account to your in-game name')
    .addSubcommand((s) => addPlayer(s.setName('start').setDescription('Get a code shown in game (you must be online)'), { description: 'Your in-game name' }))
    .addSubcommand((s) => addText(s.setName('confirm').setDescription('Type the code you saw in game'), 'code', 'The 4 digit code', { max: 8 }))
    .addSubcommand((s) => s.setName('me').setDescription('Show who you are linked to'))
    .addSubcommand((s) => s.setName('unlink').setDescription('Remove your own link'))
    .addSubcommand((s) => s.addUserOption((o) => o.setName('member').setDescription('Discord member').setRequired(false))
      .addStringOption((o) => o.setName('player').setDescription('In-game name').setRequired(false).setAutocomplete(true))
      .setName('who').setDescription('Look up a link (admin)'))
    .addSubcommand((s) => s.addStringOption((o) => o.setName('player').setDescription('In-game name').setRequired(true).setMaxLength(32))
      .setName('remove').setDescription('Remove the link of any player (admin)'))
    .addSubcommand((s) => s.addStringOption((o) => o.setName('search').setDescription('Part of a name').setRequired(false).setMaxLength(32))
      .setName('list').setDescription('Every link (admin)')),
  access: { who: 'admin', remove: 'admin', list: 'admin', '*': 'everyone' },

  async run(ctx) {
    const s = ctx.needServer();
    const links = ctx.bot.links;
    if (ctx.sub === 'list') {
      const q = String(ctx.opt('search') || '').toLowerCase();
      const rows = Object.entries(links.doc(s)).filter(([, l]) => l.username.toLowerCase().includes(q));
      return ctx.info(`Links: ${rows.length}`, list(rows.map(([id, l]) => `**${l.username}** is <@${id}>`), 'Nobody is linked yet.'));
    }
    if (ctx.sub === 'start') {
      ctx.needOnline();
      const name = await links.begin(s, ctx.user.id, ctx.player());
      return ctx.info('Check your screen in game', `A 4 digit code was shown to **${name}**. Now use \`/link confirm\` with it within 5 minutes.`);
    }
    if (ctx.sub === 'confirm') {
      const name = links.confirm(s, ctx.user.id, ctx.opt('code'));
      return ctx.ok('Linked', `Your Discord account is now linked to **${name}**.`);
    }
    if (ctx.sub === 'me') {
      const l = links.of(s, ctx.user.id);
      return l ? ctx.info('Your link', `You are **${l.username}** on ${s.name}.`) : ctx.info('Not linked', 'Use `/link start` while you are in game.');
    }
    if (ctx.sub === 'unlink') {
      return links.remove(s, ctx.user.id) ? ctx.ok('Unlinked', 'Your link is removed.') : ctx.info('Not linked', 'You had no link.');
    }
    if (ctx.sub === 'who') {
      const member = ctx.member('member');
      const player = ctx.name('player', { required: false });
      if (member) {
        const l = links.of(s, member.id);
        return ctx.info('Link', l ? `<@${member.id}> is **${l.username}**.` : `<@${member.id}> is not linked.`);
      }
      if (player) {
        const owner = links.ownerOf(s, player);
        return ctx.info('Link', owner ? `**${player}** is <@${owner}>.` : `**${player}** is not linked.`);
      }
      throw new UserError('Pick a member or a player.');
    }
    const player = ctx.name('player');
    const owner = links.removeName(s, player);
    ctx.note(player);
    return owner ? ctx.ok('Link removed', `${player} is no longer linked to <@${owner}>.`) : ctx.warn('Not linked', `${player} had no link.`);
  },
};
