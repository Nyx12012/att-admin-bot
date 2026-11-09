const { SlashCommandBuilder } = require('discord.js');
const { addText, addInt } = require('../core/opts');
const { isSafeName, UserError } = require('../game/text');
const targets = require('../core/targets');

function nameOpt(s, description) {
  return s.addStringOption((o) => o.setName('player').setDescription(description).setRequired(true).setAutocomplete(true).setMaxLength(32));
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Ban players (kept by the bot, kicked when they join)')
    .addSubcommand((s) => addText(addInt(nameOpt(s.setName('add').setDescription('Ban a player, online or not'), 'In-game name'), 'hours', 'How long, leave empty for permanent', { required: false, min: 1, max: 87600 }), 'reason', 'Why', { required: false, max: 150 }))
    .addSubcommand((s) => nameOpt(s.setName('remove').setDescription('Lift a ban'), 'Banned name'))
    .addSubcommand((s) => s.setName('list').setDescription('Every active ban'))
    .addSubcommand((s) => nameOpt(s.setName('info').setDescription('Details of one ban'), 'Banned name')),
  access: 'admin',

  async autocomplete(ctx, focused) {
    if (!ctx.server) return [];
    const q = String(focused.value).toLowerCase();
    if (ctx.sub === 'add') return targets.choices(ctx.bot, ctx.server, focused.value);
    return ctx.bot.bans.list(ctx.server).map((b) => b.username).filter((n) => n.toLowerCase().includes(q));
  },

  async run(ctx) {
    const s = ctx.needServer();
    if (ctx.sub === 'list') {
      const list = ctx.bot.bans.list(s);
      const lines = list.map((b) => `**${b.username}** ${b.until ? `until <t:${Math.floor(b.until / 1000)}:R>` : 'permanent'}: ${b.reason}`);
      return ctx.info(`Bans on ${s.name}: ${list.length}`, lines.join('\n') || 'Nobody is banned.');
    }
    const input = ctx.name('player');
    if (ctx.sub === 'info') {
      const b = ctx.bot.bans.get(s, input);
      if (!b) return ctx.warn('Not banned', `${input} is not banned.`);
      return ctx.reply({ embeds: [ctx.bot.bans.card(b)] });
    }
    if (ctx.sub === 'remove') {
      const b = ctx.bot.bans.remove(s, input);
      ctx.note(input);
      if (!b) return ctx.warn('Not banned', `${input} is not banned.`);
      ctx.bot.logs.line(s, 'bans', `**${b.username}** was unbanned by ${ctx.user.tag}.`);
      return ctx.ok('Unbanned', `**${b.username}** can join again.`);
    }
    const online = s.roster.get(input.toLowerCase()) || null;
    const name = online ? online.username : input;
    if (!isSafeName(name)) throw new UserError(`"${name}" is not a valid in-game name, so the bot cannot enforce a ban on it. Use the blacklist in the Server launcher instead.`);
    const ban = ctx.bot.bans.add(s, name, { hours: ctx.opt('hours') || 0, reason: ctx.opt('reason') || '', by: ctx.user.tag });
    ctx.note(`${name} ${ban.until ? `${ctx.opt('hours')}h` : 'permanent'}: ${ban.reason}`);
    ctx.bot.logs.line(s, 'bans', `**${name}** was banned by ${ctx.user.tag}${ban.until ? ` for ${ctx.opt('hours')} h` : ''}: ${ban.reason}`);
    let note = 'They will be kicked the next time they join.';
    if (online && s.online) {
      const kicked = await ctx.bot.bans.enforce(s, name, { quiet: true });
      note = kicked === 'kicked' ? 'They were online and have been kicked.' : 'They are online, but the kick failed. They will be kicked when they join again, or use /kick.';
    }
    return ctx.reply({ embeds: [ctx.bot.bans.card(ban).setDescription(note)] });
  },
};
