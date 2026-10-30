const { SlashCommandBuilder } = require('discord.js');
const { UserError } = require('../game/text');

function addTarget(s) {
  return s
    .addStringOption((o) => o.setName('command').setDescription('Command, or command and subcommand like "cleanup.run"').setRequired(true).setAutocomplete(true))
    .addRoleOption((o) => o.setName('role').setDescription('A role').setRequired(false))
    .addUserOption((o) => o.setName('user').setDescription('A member').setRequired(false));
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('permissions')
    .setDescription('Let roles or members use admin commands')
    .addSubcommand((s) => addTarget(s.setName('grant').setDescription('Allow a role or member to use a command')))
    .addSubcommand((s) => addTarget(s.setName('revoke').setDescription('Take a command away again')))
    .addSubcommand((s) => s.setName('list').setDescription('Show every grant')),
  access: 'owner',

  async autocomplete(ctx, focused) {
    const q = String(focused.value).toLowerCase();
    const keys = [];
    for (const cmd of ctx.bot.registry.commands.values()) {
      const json = cmd.data.toJSON();
      keys.push(json.name);
      for (const o of json.options || []) {
        if (o.type === 1) keys.push(`${json.name}.${o.name}`);
        if (o.type === 2) for (const s of o.options || []) keys.push(`${json.name}.${o.name}.${s.name}`);
      }
    }
    return keys.filter((k) => k.includes(q)).slice(0, 25);
  },

  async run(ctx) {
    const gid = ctx.guildId;
    if (ctx.sub === 'list') {
      const grants = ctx.bot.permissions.grants(gid);
      const lines = Object.entries(grants).map(([k, g]) => `\`/${k.replace(/\./g, ' ')}\`: ${[...g.roles.map((r) => `<@&${r}>`), ...g.users.map((u) => `<@${u}>`)].join(', ')}`);
      return ctx.info('Permissions', [
        'Server owner and bot owners can use everything.',
        'Members with the Administrator permission can use admin commands.',
        'Owner only by default: /cmd, /spawn, /kit give, /permissions, /settings set, /world.',
        '',
        lines.length ? lines.join('\n') : 'No extra grants yet.',
      ].join('\n'));
    }
    const key = String(ctx.opt('command')).replace(/^\//, '').trim().replace(/\s+/g, '.').toLowerCase();
    const base = key.split('.')[0];
    if (!ctx.bot.registry.commands.has(base)) throw new UserError(`There is no /${base} command.`);
    const role = ctx.role('role');
    const user = ctx.member('user');
    if (!role && !user) throw new UserError('Pick a role or a member.');
    const kind = role ? 'roles' : 'users';
    const id = role ? role.id : user.id;
    const label = role ? `<@&${id}>` : `<@${id}>`;
    if (ctx.sub === 'grant') {
      ctx.bot.permissions.grant(gid, key, kind, id);
      ctx.note(`${key} -> ${label}`);
      return ctx.ok('Granted', `${label} can now use \`/${key.replace(/\./g, ' ')}\`.`);
    }
    const had = ctx.bot.permissions.revoke(gid, key, kind, id);
    return had ? ctx.ok('Revoked', `${label} can no longer use \`/${key.replace(/\./g, ' ')}\` (unless another grant or Administrator allows it).`) : ctx.warn('Nothing to revoke', `${label} had no grant for \`/${key.replace(/\./g, ' ')}\`.`);
  },
};
