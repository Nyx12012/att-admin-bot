const { SlashCommandBuilder } = require('discord.js');
const { addPlayer, addName, addText, addBool } = require('../core/opts');
const items = require('../core/items');
const { UserError, safeKey, own } = require('../game/text');
const { give } = require('./spawn');

function parse(text) {
  const out = [];
  for (const part of String(text).split(/[,;\n]+/).map((x) => x.trim()).filter(Boolean)) {
    const m = part.match(/^(?:(\d+)\s*x\s*)?(.+?)(?:\s*[x*:]\s*(\d+))?$/i);
    if (!m) throw new UserError(`Cannot read "${part}".`);
    const count = Number(m[1] || m[3] || 1);
    const item = items.resolve(m[2]);
    if (!item) throw new UserError(`No item matches "${m[2]}". Use exact names or prefab hashes.`);
    out.push({ hash: item.hash, name: item.name, count: Math.max(1, Math.min(50, count)) });
  }
  if (out.length === 0) throw new UserError('List at least one item, like "Iron Ingot x5, Wooden Bag".');
  if (out.reduce((n, x) => n + x.count, 0) > 100) throw new UserError('A kit can hold at most 100 items in total.');
  return out;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('kit')
    .setDescription('Item bundles you can hand out')
    .addSubcommand((s) => addText(addName(s.setName('create').setDescription('Make or replace a kit'), 'name', 'Kit name'), 'items', 'Like: Iron Ingot x5, Wooden Bag, 3 x Stick', { max: 1000 }))
    .addSubcommand((s) => addBool(addName(addPlayer(s.setName('give').setDescription('Spawn a kit in front of a player')), 'kit', 'Which kit', { auto: true }), 'mail', 'Send it to their mailbox instead (needs BotCore)', { required: false }))
    .addSubcommand((s) => s.setName('list').setDescription('Every kit'))
    .addSubcommand((s) => addName(s.setName('delete').setDescription('Delete a kit'), 'kit', 'Which kit', { auto: true })),
  access: { give: 'owner', '*': 'admin' },

  async run(ctx) {
    const s = ctx.needServer();
    const kits = ctx.data('kits', {});
    if (ctx.sub === 'list') {
      const lines = Object.entries(kits).map(([k, v]) => `**${k}**: ${v.items.map((x) => `${x.count} x ${x.name}`).join(', ')}`);
      return ctx.info('Kits', lines.join('\n') || 'No kits yet. Make one with /kit create.');
    }
    if (ctx.sub === 'create') {
      const key = safeKey(ctx.opt('name'));
      kits[key] = { items: parse(ctx.opt('items')), by: ctx.user.tag, at: Date.now() };
      ctx.save('kits');
      ctx.note(`${key}: ${kits[key].items.map((x) => `${x.count}x${x.hash}`).join(',')}`);
      return ctx.ok('Kit saved', `**${key}**: ${kits[key].items.map((x) => `${x.count} x ${x.name}`).join(', ')}`);
    }
    const key = String(ctx.opt('kit')).toLowerCase();
    const kit = own(kits, key);
    if (!kit) throw new UserError(`There is no kit called "${key}".`);
    if (ctx.sub === 'delete') {
      delete kits[key];
      ctx.save('kits');
      return ctx.ok('Kit deleted', `${key} is gone.`);
    }
    ctx.needOnline();
    const name = ctx.player();
    const lines = [];
    for (const x of kit.items) {
      let made = 0;
      if (ctx.opt('mail')) {
        const user = await s.lookup(name);
        for (let i = 0; i < x.count; i += 1) {
          const r = await s.run(`trade post "${user.username}" ${x.hash} 1`, { allowError: true });
          if (r.error) break;
          made += 1;
        }
      } else {
        made = await give(s, name, items.byHash(x.hash) || { hash: x.hash, name: x.name }, x.count);
      }
      lines.push(`${made} x ${x.name}`);
    }
    ctx.note(`${key} to ${name}`);
    return ctx.ok(`Kit ${key} given to ${name}`, lines.join('\n'));
  },
};
