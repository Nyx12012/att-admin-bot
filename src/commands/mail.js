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
    const sent = await ctx.bot.economy.deliver(s, user.username, item, amount, { material: material && material.value, forged: Boolean(ctx.opt('forged')) });
    const label = materials.named(item.name, material);
    ctx.note(`${sent.delivered} x ${label} to ${user.username}`);
    if (sent.delivered === 0) throw new UserError(`Nothing was mailed. ${sent.problem || ''}`.trim());
    const how = sent.pouches ? ` in ${sent.pouches} pouch${sent.pouches === 1 ? '' : 'es'}` : '';
    if (sent.delivered < amount) return ctx.warn('Partly mailed', `${sent.delivered} of ${amount} x **${label}** reached ${user.username}'s mailbox${how}. ${sent.problem || ''}`.trim());
    return ctx.ok('Mailed', `${amount} x **${label}** is waiting in ${user.username}'s mailbox${how}.`);
  },
};
