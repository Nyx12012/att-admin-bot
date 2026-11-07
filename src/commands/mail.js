const { SlashCommandBuilder } = require('discord.js');
const { addItem, addInt, addBool } = require('../core/opts');
const items = require('../core/items');
const { UserError } = require('../game/text');

module.exports = {
  data: addBool(addInt(addInt(addItem(new SlashCommandBuilder().setName('mail').setDescription("Send items to a player's mailbox, online or not (needs BotCore)")
    .addStringOption((o) => o.setName('player').setDescription('In-game name').setRequired(true).setAutocomplete(true).setMaxLength(32))), 'amount', 'How many (default 1)', { required: false, min: 1, max: 100 }), 'texture', 'Texture number, for items that have one', { required: false, min: 0, max: 2147483647 }), 'forged', 'Send it finished, ready to use', { required: false }),
  access: 'owner',

  async run(ctx) {
    const s = ctx.needOnline();
    const user = await s.lookup(String(ctx.opt('player')).trim());
    const item = items.resolve(ctx.opt('item'));
    if (!item) throw new UserError(`No item matches "${ctx.opt('item')}".`);
    const amount = ctx.opt('amount') || 1;
    const texture = ctx.opt('texture');
    await s.run(`trade post "${user.username}" ${item.hash}${texture != null ? ` ${texture}` : ''} ${amount}${ctx.opt('forged') ? ' forged' : ''}`);
    ctx.note(`${amount} x ${item.name} to ${user.username}`);
    return ctx.ok('Mailed', `${amount} x **${item.name}** is waiting in ${user.username}'s mailbox.`);
  },
};
