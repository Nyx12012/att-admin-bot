const { SlashCommandBuilder } = require('discord.js');

const GROUPS = [
  ['Getting started', ['setup', 'permissions', 'link', 'status', 'help', 'bot']],
  ['Moderation', ['players', 'l', 'kick', 'ban', 'message', 'announce', 'purge']],
  ['Players', ['player', 'tp', 'location', 'home', 'kill', 'heal', 'godmode', 'stat', 'spawn', 'kit']],
  ['World and server', ['time', 'settings', 'save', 'boot', 'shutdown', 'restart', 'festival', 'world', 'cmd']],
  ['Cleanup', ['cleanup']],
  ['Plots', ['plot', 'chunk']],
  ['Fun', ['fun', 'buff']],
  ['Alchemy', ['alchemy']],
  ['Fun and numbers', ['stats', 'playtime', 'autobuff']],
  ['Admin tools', ['controlpanel', 'cc', 'string', 'chunks', 'items', 'report', 'say', 'embed', 'poll']],
  ['Cleanup by hand', ['despawn', 'despawnmenu', 'wipe']],
  ['Needs the BotCore server mod', ['shop', 'sell', 'balance', 'withdraw', 'atm', 'mail']],
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('What the bot can do')
    .addStringOption((o) => o.setName('command').setDescription('One command to explain').setRequired(false).setAutocomplete(true)),
  access: 'everyone',

  async autocomplete(ctx, focused) {
    return [...ctx.bot.registry.commands.keys()].filter((k) => k.includes(String(focused.value).toLowerCase())).sort();
  },

  async run(ctx) {
    const cmds = ctx.bot.registry.commands;
    const one = ctx.opt('command');
    if (one) {
      const cmd = cmds.get(String(one).replace(/^\//, '').toLowerCase());
      if (!cmd) return ctx.warn('Unknown command', `There is no /${one}.`);
      const json = cmd.data.toJSON();
      const subs = (json.options || []).filter((o) => o.type === 1 || o.type === 2);
      const lines = subs.length
        ? subs.map((s) => `\`/${json.name} ${s.name}\` ${s.description}`)
        : [(json.options || []).map((o) => `\`${o.name}\` ${o.description}`).join('\n') || 'No options.'];
      return ctx.info(`/${json.name}`, `${json.description}\n\n${lines.join('\n')}`);
    }
    const fields = GROUPS.map(([title, names]) => [title, names.filter((n) => cmds.has(n)).map((n) => `\`/${n}\` ${cmds.get(n).data.description}`).join('\n'), false]);
    const known = new Set(GROUPS.flatMap((g) => g[1]));
    const extra = [...cmds.keys()].filter((n) => !known.has(n));
    if (extra.length) fields.push(['More', extra.map((n) => `\`/${n}\` ${cmds.get(n).data.description}`).join('\n'), false]);
    return ctx.info('Commands', 'Use `/help command:<name>` for the subcommands of one command.', fields);
  },
};
