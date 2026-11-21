const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder().setName('balance').setDescription('How many coins are in your ATM (needs BotCore)'),
  access: 'everyone',

  async run(ctx) {
    const s = ctx.needOnline();
    ctx.requireLink('Link your account with /link first.');
    const user = await s.lookup(ctx.self());
    return ctx.info(`${user.username}: ATM`, `${await ctx.bot.economy.coins(s, user)} coins.`);
  },
};
