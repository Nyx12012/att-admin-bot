const { SlashCommandBuilder } = require('discord.js');
const { addName, addText, addPlayer, addInt, addBool } = require('../core/opts');
const { UserError, safeKey, own, quoteName } = require('../game/text');

const MAX = 20;

function kit(s) {
  return addName(s, 'kit', 'Console kit name', { auto: true });
}

function tablet(ctx, key, list) {
  const actions = ctx.data('actions', {});
  if (ctx.opt('off')) {
    const had = Boolean(own(actions, key));
    delete actions[key];
    ctx.save('actions');
    ctx.note(`${key} off the tablet`);
    return had ? ctx.ok('Off the tablet', key) : ctx.warn('Not on the tablet', key);
  }
  const a = own(actions, key) || { roles: [], gameRoles: [], target: 'self', cooldown: 0, label: key };
  const role = ctx.role('role');
  const game = ctx.opt('gamerole') ? String(ctx.opt('gamerole')).trim().toLowerCase() : null;
  if (game && !/^[a-z0-9 _-]{1,40}$/.test(game)) throw new UserError('Game role names use letters, numbers, spaces, - and _.');
  if (role && !a.roles.includes(role.id)) a.roles.push(role.id);
  if (game && !a.gameRoles.includes(game)) a.gameRoles.push(game);
  if (ctx.opt('target')) a.target = ctx.opt('target');
  if (ctx.opt('cooldown') != null) a.cooldown = ctx.opt('cooldown');
  if (ctx.opt('label')) a.label = String(ctx.opt('label')).trim();
  if (a.roles.length === 0 && a.gameRoles.length === 0) throw new UserError('Pick a Discord role or a game role (everyone works too) that sees it.');
  if (a.target === 'self' && !list.some((c) => c.includes('{player}'))) ctx.note('no {player} in the kit');
  actions[key] = a;
  ctx.save('actions');
  ctx.note(`${key} on the tablet for ${a.roles.length} Discord and ${a.gameRoles.join(',') || 'no'} game roles`);
  const who = [...a.roles.map((r) => `<@&${r}>`), ...a.gameRoles].join(', ');
  return ctx.ok('On the tablet', `**${a.label}** runs the kit ${key} on ${a.target === 'self' ? 'the player who taps it' : 'a player they pick'}.\nSeen by: ${who}.\nCooldown: ${a.cooldown ? `${a.cooldown} minutes` : 'none'}.\nThey find it under Actions on the bot tablet.`);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('cc')
    .setDescription('Console kits: saved lists of console commands')
    .addSubcommand((s) => addText(addName(s.setName('create').setDescription('Make or replace a kit'), 'name', 'Kit name'), 'command', 'First command. {player} is the player you run it on', { max: 300 }))
    .addSubcommand((s) => addText(kit(s.setName('add').setDescription('Add a command to a kit')), 'command', 'Console command', { max: 300 }))
    .addSubcommand((s) => addPlayer(kit(s.setName('run').setDescription('Run a kit, in order')), { required: false, description: 'Fills in {player}' }))
    .addSubcommand((s) => kit(s.setName('view').setDescription('Show a kit')))
    .addSubcommand((s) => kit(s.setName('delete').setDescription('Delete a kit')))
    .addSubcommand((s) => s.setName('list').setDescription('Every kit'))
    .addSubcommand((s) => addBool(addName(addInt(kit(s.setName('tablet').setDescription('Show a kit as a button on the in-game bot tablet'))
      .addRoleOption((o) => o.setName('role').setDescription('Discord role that sees it (the player must be linked)').setRequired(false)), 'cooldown', 'Minutes before the same player can use it again', { required: false, min: 0, max: 10080 }),
    'gamerole', 'Or a role from the Server launcher, like miner, or everyone', { required: false, max: 40 })
      .addStringOption((o) => o.setName('target').setDescription('Who {player} is').setRequired(false).addChoices({ name: 'the player who taps it', value: 'self' }, { name: 'a player they pick', value: 'player' }))
      .addStringOption((o) => o.setName('label').setDescription('Button text on the tablet').setRequired(false).setMaxLength(28)), 'off', 'Take the kit off the tablet', { required: false })),
  access: 'owner',

  async autocomplete(ctx, focused) {
    if (!ctx.server || focused.name !== 'kit') return [];
    return Object.keys(ctx.data('cc', {})).filter((k) => k.includes(String(focused.value).toLowerCase()));
  },

  async run(ctx) {
    const s = ctx.needServer();
    const kits = ctx.data('cc', {});
    if (ctx.sub === 'list') return ctx.info('Console kits', Object.entries(kits).map(([k, v]) => `**${k}**: ${v.length} command(s)`).join('\n') || 'None yet.');
    const check = (text) => {
      const c = String(text).trim();
      if (/[\r\n]/.test(c)) throw new UserError('A command must be one line.');
      return c;
    };
    if (ctx.sub === 'create') {
      const key = safeKey(ctx.opt('name'));
      kits[key] = [check(ctx.opt('command'))];
      ctx.save('cc');
      ctx.note(`${key}: ${kits[key][0]}`);
      return ctx.ok('Kit saved', key);
    }
    const key = String(ctx.opt('kit')).toLowerCase();
    const list = own(kits, key);
    if (!list) throw new UserError(`There is no console kit called "${key}".`);
    if (ctx.sub === 'view') return ctx.info(key, list.map((c, i) => `${i + 1}. \`${c.replace(/`/g, "'")}\``).join('\n'));
    if (ctx.sub === 'tablet') return tablet(ctx, key, list);
    if (ctx.sub === 'delete') {
      delete kits[key];
      delete ctx.data('actions', {})[key];
      ctx.save('actions');
      ctx.save('cc');
      ctx.note(key);
      return ctx.ok('Kit deleted', key);
    }
    if (ctx.sub === 'add') {
      if (list.length >= MAX) throw new UserError(`A kit holds at most ${MAX} commands.`);
      list.push(check(ctx.opt('command')));
      ctx.save('cc');
      ctx.note(`${key}: ${list[list.length - 1]}`);
      return ctx.ok('Added', `${key} now has ${list.length} command(s).`);
    }
    ctx.needOnline();
    const player = ctx.opt('player') ? ctx.player() : null;
    const out = [];
    for (const template of list) {
      if (/\{player\}/.test(template) && !player) throw new UserError('This kit uses {player}, so pick a player.');
      const text = player ? template.replace(/"?\{player\}"?/g, () => quoteName(player)) : template;
      const r = await s.run(text, { allowError: true, timeout: 60000 });
      out.push(`${r.error ? 'failed' : 'ok'}: \`${text.replace(/`/g, "'")}\``);
    }
    ctx.note(`${key}${player ? ` on ${player}` : ''}`);
    return ctx.info(`Ran ${key}`, out.join('\n'));
  },
};
