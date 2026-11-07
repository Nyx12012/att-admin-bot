const { SlashCommandBuilder } = require('discord.js');
const { addInt } = require('../core/opts');
const { UserError } = require('../game/text');

module.exports = {
  data: addInt(new SlashCommandBuilder().setName('withdraw').setDescription('Turn ATM coins into a gold pouch in your mailbox (needs BotCore)'), 'amount', 'How many coins', { min: 1, max: 1000000 }),
  access: 'everyone',

  async run(ctx) {
    const s = ctx.needServer();
    if (!ctx.bot.links.of(s, ctx.user.id)) throw new UserError('Link your account with /link first.');
    const amount = ctx.opt('amount');
    const r = await ctx.bot.economy.withdraw(ctx, amount);
    return ctx.ok('Withdrawn', `A pouch of **${amount} coins** is in your mailbox. Your ATM holds ${r.after}.`);
  },
};
