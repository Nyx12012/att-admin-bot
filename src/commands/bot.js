const { SlashCommandBuilder } = require('discord.js');
const { UserError } = require('../game/text');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('bot')
    .setDescription('Stop or restart this Discord bot, not the game server (owner only by default)')
    .addSubcommand((s) => s.setName('stop').setDescription('Stop the bot. Discord cannot bring it back'))
    .addSubcommand((s) => s.setName('restart').setDescription('Restart the bot, for example after changing .env')),
  access: 'owner',
  public: true,

  async run(ctx) {
    const { life } = ctx.bot;
    if (ctx.sub === 'stop') {
      if (life.kind === 'pm2') throw new UserError(`This bot runs under pm2, which starts it again the moment it stops, so /bot stop cannot keep it down. On the PC use: pm2 stop ${life.name}`);
      if (!(await ctx.confirm('Stop this bot?', 'Discord cannot bring it back. The bot stays down until the next game server start or until someone runs start.bat on the PC, and /boot and every other command stop working until then. The game server keeps running: /shutdown is the command that closes it.', { label: 'Stop bot' }))) return null;
      await ctx.ok('Stopping', 'The bot is going offline. Start the game server or run start.bat to bring it back.');
      life.stop();
      return null;
    }
    if (!(await ctx.confirm('Restart this bot?', 'Only the Discord bot restarts and the game server keeps running. /restart is the command that restarts the game server. The bot is gone for a few seconds.', { label: 'Restart bot', danger: false }))) return null;
    await ctx.ok('Restarting', 'The bot will be back in a few seconds.');
    life.restart();
    return null;
  },
};
