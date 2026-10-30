const { SlashCommandBuilder } = require('discord.js');
const { addItem, addInt } = require('../core/opts');
const items = require('../core/items');
const { UserError } = require('../game/text');

module.exports = {
  data: addInt(addItem(new SlashCommandBuilder().setName('mail').setDescription("Send items to a player's mailbox, online or not (needs BotCore)")
    .addStringOption((o) => o.setName('player').setDescription('In-game name').setRequired(true).setAutocomplete(true).setMaxLength(32))), 'amount', 'How many (default 1)', { required: false, min: 1, max: 100 }),
  access: 'owner',

  async run(ctx) {
    const s = ctx.needOnline();
    const user = await s.lookup(String(ctx.opt('player')).trim());
    const item = items.resolve(ctx.opt('item'));
    if (!item) throw new UserError(`No item matches "${ctx.opt('item')}".`);
    const amount = ctx.opt('amount') || 1;
    await s.run(`trade post "${user.username}" ${item.hash} ${amount}`);
    ctx.note(`${amount} x ${item.name} to ${user.username}`);
    return ctx.ok('Mailed', `${amount} x **${item.name}** is waiting in ${user.username}'s mailbox.`);
  },
};
