const { SlashCommandBuilder } = require('discord.js');
const { addName, addText, addPlayer } = require('../core/opts');
const { UserError, safeKey, own, quoteName } = require('../game/text');

const MAX = 20;

function kit(s) {
  return addName(s, 'kit', 'Console kit name', { auto: true });
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
    .addSubcommand((s) => s.setName('list').setDescription('Every kit')),
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
    if (ctx.sub === 'delete') {
      delete kits[key];
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
