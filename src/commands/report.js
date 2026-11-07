const { SlashCommandBuilder } = require('discord.js');
const { addName, addText } = require('../core/opts');
const { UserError, safeKey, own } = require('../game/text');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('report')
    .setDescription('What happens when a player is reported on the tablet (needs TavernEssentials)')
    .addSubcommand((s) => s.setName('show').setDescription('The current rules'))
    .addSubcommand((s) => s.setName('ping').setDescription('Ping a role with every report')
      .addRoleOption((o) => o.setName('role').setDescription('The role, empty means no ping').setRequired(false)))
    .addSubcommand((s) => addText(addName(s.setName('action').setDescription('Run a console command on a report'), 'reason', 'Report reason, or "any"', { max: 40 }), 'command', 'Command. {reported}, {reporter} and {reason} are filled in', { max: 300 }))
    .addSubcommand((s) => addName(s.setName('clear').setDescription('Remove the commands of one reason'), 'reason', 'Report reason, or "any"', { max: 40 })),
  access: { show: 'admin', ping: 'admin', '*': 'owner' },

  async run(ctx) {
    const s = ctx.needServer();
    const reports = ctx.bot.reports;
    const d = reports.doc(s);
    if (ctx.sub === 'show') {
      const lines = Object.entries(d.actions).map(([k, list]) => `**${k}**\n${list.map((c) => `\`${c.replace(/`/g, "'")}\``).join('\n')}`);
      return ctx.info('Report rules', `Ping: ${d.role ? `<@&${d.role}>` : 'nobody'}\n\n${lines.join('\n') || 'No commands run on reports.'}\n\nTablet reports only reach the bot on servers running TavernEssentials.`);
    }
    if (ctx.sub === 'ping') {
      const role = ctx.role('role');
      d.role = role ? role.id : null;
      reports.save(s);
      return ctx.ok('Report ping', role ? `Reports ping <@&${role.id}>.` : 'Reports ping nobody.');
    }
    const key = safeKey(String(ctx.opt('reason')).replace(/\s+/g, '-'));
    if (ctx.sub === 'clear') {
      if (!own(d.actions, key)) throw new UserError(`There are no commands for "${key}".`);
      delete d.actions[key];
      reports.save(s);
      return ctx.ok('Cleared', key);
    }
    const command = String(ctx.opt('command')).trim();
    if (/[\r\n]/.test(command)) throw new UserError('A command must be one line.');
    d.actions[key] = [...(own(d.actions, key) || []), command].slice(-5);
    reports.save(s);
    ctx.note(`${key}: ${command}`);
    return ctx.ok('Action added', `On a report for **${key}** the bot runs:\n\`${command.replace(/`/g, "'")}\``);
  },
};
