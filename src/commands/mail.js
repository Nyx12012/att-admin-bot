const { SlashCommandBuilder } = require('discord.js');
const { addItem, addInt, addBool, addMaterial } = require('../core/opts');
const items = require('../core/items');
const materials = require('../core/materials');
const { UserError } = require('../game/text');

module.exports = {
  data: addBool(addMaterial(addInt(addItem(new SlashCommandBuilder().setName('mail').setDescription("Send items to a player's mailbox, online or not (needs BotCore)")
    .addStringOption((o) => o.setName('player').setDescription('In-game name').setRequired(true).setAutocomplete(true).setMaxLength(32))), 'amount', 'How many (default 1)', { required: false, min: 1, max: 100 })), 'forged', 'Send it finished, ready to use', { required: false }),
  access: 'owner',

  async run(ctx) {
    const s = ctx.needOnline();
    const user = await s.lookup(ctx.name('player'));
    const item = items.resolve(ctx.opt('item'));
    if (!item) throw new UserError(`No item matches "${ctx.opt('item')}".`);
    const amount = ctx.opt('amount') || 1;
    const material = materials.fromOption(ctx.opt('material'));
    await s.run(`trade post "${user.username}" ${item.hash}${material ? ` ${material.value}` : ''} ${amount}${ctx.opt('forged') ? ' forged' : ''}`);
    const label = materials.named(item.name, material);
    ctx.note(`${amount} x ${label} to ${user.username}`);
    return ctx.ok('Mailed', `${amount} x **${label}** is waiting in ${user.username}'s mailbox.`);
  },
};
