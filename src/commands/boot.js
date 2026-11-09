const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder().setName('boot').setDescription('Start the game server when it is down'),
  access: 'admin',
  public: true,

  async run(ctx) {
    const s = ctx.needServer();
    await ctx.bot.power.boot(s);
    ctx.note(s.name);
    return ctx.ok('Starting', `${s.name} is starting. Players can join in a few minutes.`);
  },
};
