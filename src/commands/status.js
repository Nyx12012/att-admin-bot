const { SlashCommandBuilder } = require('discord.js');
const { ago } = require('../core/ui');

module.exports = {
  data: new SlashCommandBuilder().setName('status').setDescription('Is the game server up, and how is it doing'),
  access: 'everyone',
  public: true,

  async run(ctx) {
    const s = ctx.needServer();
    if (!s.online) {
      return ctx.warn(`${s.name}: not connected`, s.lastError ? `Last error: ${s.lastError}` : 'The bot is waiting for the game console.');
    }
    const started = Date.now();
    let stats = null;
    try {
      stats = await s.value('debug server-stats', { timeout: 10000 });
    } catch {
      stats = null;
    }
    const ping = Date.now() - started;
    const fields = [
      ['Players', String(s.roster.size), true],
      ['Console reply', `${ping} ms`, true],
      ['Connected for', ago(s.readyAt), true],
      ['BotCore', s.botcore || 'not installed', true],
    ];
    if (stats && typeof stats === 'object') {
      if (stats.fps != null) fields.push(['Server FPS', Number(stats.fps).toFixed(1), true]);
      if (stats.overworldLoaded != null) fields.push(['Loaded chunks', `${stats.overworldLoaded} overworld, ${stats.cavesLoaded ?? 0} cave`, true]);
    }
    return ctx.info(`${s.name}: online`, null, fields);
  },
};
