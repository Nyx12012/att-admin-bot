const { SlashCommandBuilder } = require('discord.js');
const { addPlayer, addName, addText, addInt, addNumber, addBool, addChoice, addItem } = require('../core/opts');
const items = require('../core/items');
const { UserError, safeKey, own, cleanText, isSafeName } = require('../game/text');
const Alchemy = require('../features/alchemy');

function ruleName(s, description = 'Name, used to view and delete it') {
  return addName(s, 'name', description, { auto: true });
}

function names(list) {
  return (list || []).map((h) => (items.byHash(h) || {}).name || `Prefab ${h}`).join(', ');
}

function whitelist(text) {
  const list = String(text || '').split(/[,;]+/).map((x) => x.trim()).filter(Boolean);
  for (const n of list) if (!isSafeName(n)) throw new UserError(`"${n.slice(0, 40)}" is not a valid in-game name.`);
  return list;
}

function describe(r) {
  const out = [
    `Pockets: ${names(r.slots)}${r.ordered ? ' (in this order, left to right)' : ' (any order)'}`,
    `Fires: ${r.trigger === 'hands' ? 'hands together' : 'as soon as the items are in place'}`,
    `Items used up: ${r.consume ? 'yes' : 'no'}`,
  ];
  if (r.commands.length) out.push(`Commands${r.delay ? ` (${r.delay} s apart)` : ''}:\n${r.commands.map((c, i) => `${i + 1}. \`${c.replace(/`/g, "'")}\``).join('\n')}`);
  if (r.give) out.push(`Gives: ${r.give.count} x ${names([r.give.hash])}`);
  if (r.buff) out.push(`Buff: ${r.buff.stat} ${r.buff.multiply ? 'times' : 'plus'} ${r.buff.value} for ${r.buff.seconds} s`);
  if (r.cooldown) out.push(`Cooldown: ${r.cooldown} s per player`);
  if (r.whitelist.length) out.push(`Only for: ${r.whitelist.join(', ')}`);
  if (r.aoe) out.push(`Area: everyone in the chunk${r.aoeCaster ? ', caster too' : ', not the caster'}`);
  if (r.text) out.push(`Message: ${r.text}`);
  out.push(r.on ? 'Status: on' : 'Status: off');
  return out.join('\n');
}

function describeHold(h) {
  return [
    `Item: ${names([h.hash])}${h.print ? ' with one exact save string' : ''}`,
    `Where: ${h.where === 'hand' ? 'in a hand' : h.where === 'pocket' ? 'in a hand or front pocket' : 'anywhere on the player'}`,
    `Buff: ${h.stats.map((b) => `${b.stat} ${b.multiply ? 'times' : 'plus'} ${b.value}`).join(', ')}`,
    h.whitelist.length ? `Only for: ${h.whitelist.join(', ')}` : 'For: whoever carries it',
    h.on ? 'Status: on' : 'Status: off',
  ].join('\n');
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('alchemy')
    .setDescription('Build your own item recipes and item buffs for this server')
    .addSubcommand((s) => {
      const b = addBool(addText(addName(s.setName('create').setDescription('Link items in the front pockets to console commands'), 'name', 'Name, used to view and delete it'), 'items', 'Item or up to 4 for the pockets, split by commas, left to right', { max: 200 }), 'delete_items', 'Use the items up when it fires');
      addText(b, 'command', 'Console command. {player} is the user, {caster} the one who fired it', { required: false, max: 300 });
      for (const n of [2, 3, 4, 5]) addText(b, `command${n}`, `Command number ${n}`, { required: false, max: 300 });
      addItem(b, { required: false, name: 'gives', description: 'Item to give, to the mailbox with BotCore' });
      addInt(b, 'gives_amount', 'How many to give (default 1)', { required: false, min: 1, max: 25 });
      addChoice(b, 'trigger', 'When it fires (default hands together)', [{ name: 'hands together', value: 'hands' }, { name: 'as soon as the items are in place', value: 'pockets' }], { required: false });
      addBool(b, 'any_order', 'Pockets can be in any order', { required: false });
      addInt(b, 'cooldown', 'Seconds before a player can use it again', { required: false, min: 0, max: 86400 });
      addInt(b, 'delay', 'Seconds between commands', { required: false, min: 0, max: 60 });
      addText(b, 'whitelist', 'Only these in-game names can use it, split by commas', { required: false, max: 200 });
      addBool(b, 'aoe', 'Run on everyone in the chunk of the caster', { required: false });
      addBool(b, 'aoe_caster', 'With aoe: the caster is included too (default yes)', { required: false });
      addText(b, 'message', 'Text shown to the caster', { required: false, max: 120 });
      addName(b, 'buff_stat', 'Stat to buff, like speed or damage', { required: false, auto: true, max: 40 });
      addNumber(b, 'buff_value', 'How much to add', { required: false, min: -100, max: 100 });
      addInt(b, 'buff_seconds', 'How long the buff lasts (default 60)', { required: false, min: 1, max: 86400 });
      return addBool(b, 'buff_multiply', 'Multiply the stat instead of adding', { required: false });
    })
    .addSubcommand((s) => addChoice(addNumber(addName(addText(addName(s.setName('hold').setDescription('Give a buff while a player carries an item or exact item string'), 'name', 'Name, used to view and delete it'), 'item', 'Item code or name', { max: 60 }), 'stat', 'Stat, like speed or damage', { auto: true, max: 40 }), 'value', 'How much to add', { min: -100, max: 100 }), 'where', 'Where they must carry it', [{ name: 'in a hand', value: 'hand' }, { name: 'in a hand or front pocket', value: 'pocket' }, { name: 'anywhere on them', value: 'any' }])
      .addBooleanOption((o) => o.setName('multiply').setDescription('Multiply the stat instead of adding').setRequired(false))
      .addStringOption((o) => o.setName('string').setDescription('Only an item built like this save string counts').setRequired(false).setMaxLength(6000))
      .addStringOption((o) => o.setName('whitelist').setDescription('Only these in-game names, split by commas').setRequired(false).setMaxLength(200))
      .addStringOption((o) => o.setName('message').setDescription('Text shown when the buff starts').setRequired(false).setMaxLength(120)))
    .addSubcommand((s) => s.setName('list').setDescription('Every recipe and item buff'))
    .addSubcommand((s) => ruleName(s.setName('view').setDescription('Details of one')))
    .addSubcommand((s) => ruleName(s.setName('delete').setDescription('Delete one')))
    .addSubcommand((s) => addBool(ruleName(s.setName('toggle').setDescription('Turn one on or off')), 'on', 'On or off'))
    .addSubcommand((s) => addPlayer(ruleName(s.setName('test').setDescription('Fire a recipe on a player without items, cooldown or checks')), { description: 'Who it fires on' })),
  access: { list: 'admin', view: 'admin', '*': 'owner' },

  async autocomplete(ctx, focused) {
    if (!ctx.server) return [];
    const q = String(focused.value).toLowerCase();
    if (focused.name === 'name' && ctx.sub !== 'create' && ctx.sub !== 'hold') {
      const d = ctx.bot.alchemy.doc(ctx.server);
      return [...Object.keys(d.recipes), ...Object.keys(d.holds)].filter((k) => k.includes(q));
    }
    if (focused.name === 'stat' || focused.name === 'buff_stat') return ctx.bot.statNames().filter((n) => n.toLowerCase().includes(q));
    return [];
  },

  async run(ctx) {
    const s = ctx.needServer();
    const al = ctx.bot.alchemy;
    const d = al.doc(s);
    if (ctx.sub === 'list') {
      const recipes = Object.values(d.recipes).map((r) => `**${r.name}**${r.on ? '' : ' (off)'}: ${names(r.slots)}`);
      const holds = Object.values(d.holds).map((h) => `**${h.name}**${h.on ? '' : ' (off)'}: ${names([h.hash])}, ${h.stats.map((b) => b.stat).join(', ')}`);
      return ctx.info('Alchemy', null, [['Recipes', recipes.join('\n') || 'None yet. Make one with /alchemy create.', false], ['Item buffs', holds.join('\n') || 'None yet. Make one with /alchemy hold.', false]]);
    }
    if (ctx.sub === 'create') {
      const name = safeKey(ctx.opt('name'));
      if (own(d.holds, name)) throw new UserError(`An item buff is already called "${name}".`);
      const commands = ['command', 'command2', 'command3', 'command4', 'command5'].map((k) => ctx.opt(k)).filter(Boolean).map(Alchemy.checkCommand);
      const givesText = ctx.opt('gives');
      const gives = givesText ? items.resolve(givesText) : null;
      if (givesText && !gives) throw new UserError(`No item matches "${givesText}".`);
      const buffStat = ctx.opt('buff_stat');
      if (buffStat && !Alchemy.STAT.test(buffStat)) throw new UserError(`"${buffStat}" is not a stat name.`);
      if (buffStat && ctx.opt('buff_value') == null) throw new UserError('Set buff_value too.');
      if (commands.length === 0 && !gives && !buffStat) throw new UserError('Give it at least one command, a gives item or a buff.');
      if (ctx.opt('trigger') === 'pockets' && !ctx.opt('delete_items') && !ctx.opt('cooldown')) throw new UserError('This fires on every inventory change. Use up the items or set a cooldown, or make it fire on hands together.');
      const r = al.makeRecipe(s, {
        name,
        slots: Alchemy.parseSlots(ctx.opt('items')),
        ordered: !ctx.opt('any_order'),
        trigger: ctx.opt('trigger') || 'hands',
        consume: ctx.opt('delete_items'),
        commands,
        give: gives ? { hash: gives.hash, count: ctx.opt('gives_amount') || 1 } : null,
        buff: buffStat ? { stat: buffStat, value: ctx.opt('buff_value'), seconds: ctx.opt('buff_seconds') || 60, multiply: Boolean(ctx.opt('buff_multiply')) } : null,
        cooldown: ctx.opt('cooldown') || 0,
        delay: ctx.opt('delay') || 0,
        whitelist: whitelist(ctx.opt('whitelist')),
        aoe: Boolean(ctx.opt('aoe')),
        aoeCaster: ctx.opt('aoe_caster') !== false,
        text: ctx.opt('message') ? cleanText(ctx.opt('message'), 120) : null,
        on: true,
        by: ctx.user.tag,
        at: Date.now(),
      });
      ctx.note(describe(r));
      return ctx.ok(`Recipe ${name} saved`, describe(r));
    }
    if (ctx.sub === 'hold') {
      const name = safeKey(ctx.opt('name'));
      if (own(d.recipes, name)) throw new UserError(`A recipe is already called "${name}".`);
      const item = items.resolve(ctx.opt('item'));
      if (!item) throw new UserError(`No item matches "${ctx.opt('item')}".`);
      if (!Alchemy.STAT.test(ctx.opt('stat'))) throw new UserError(`"${ctx.opt('stat')}" is not a stat name.`);
      let print = null;
      if (ctx.opt('string')) {
        try {
          print = Alchemy.blueprint(ctx.opt('string'));
        } catch (e) {
          throw new UserError(`That save string could not be read: ${e.message}`);
        }
      }
      const h = al.makeHold(s, {
        name,
        hash: item.hash,
        print,
        where: ctx.opt('where'),
        stats: [{ stat: ctx.opt('stat'), value: ctx.opt('value'), multiply: Boolean(ctx.opt('multiply')) }],
        whitelist: whitelist(ctx.opt('whitelist')),
        text: ctx.opt('message') ? cleanText(ctx.opt('message'), 120) : null,
        on: true,
        by: ctx.user.tag,
        at: Date.now(),
      });
      ctx.note(describeHold(h));
      return ctx.ok(`Item buff ${name} saved`, `${describeHold(h)}\n\nThe buff stops within 15 seconds of letting go.`);
    }
    const key = String(ctx.opt('name')).toLowerCase();
    const recipe = own(d.recipes, key);
    const hold = own(d.holds, key);
    if (!recipe && !hold) throw new UserError(`Nothing is called "${key}". See /alchemy list.`);
    if (ctx.sub === 'view') return ctx.info(key, recipe ? describe(recipe) : describeHold(hold));
    if (ctx.sub === 'delete') {
      al.remove(s, recipe ? 'recipes' : 'holds', key);
      ctx.note(key);
      return ctx.ok('Deleted', key);
    }
    if (ctx.sub === 'toggle') {
      (recipe || hold).on = ctx.opt('on');
      al.save(s);
      return ctx.ok(key, ctx.opt('on') ? 'On.' : 'Off.');
    }
    if (!recipe) throw new UserError('Only recipes can be tested. For an item buff, carry the item.');
    ctx.needOnline();
    const who = ctx.player();
    const r = await al.fire(s, who, recipe, [], { test: true });
    ctx.note(`${key} on ${who}`);
    return ctx[r.errors.length ? 'warn' : 'ok'](`Fired ${key} on ${who}`, [r.sent.map((c) => `\`${c.replace(/`/g, "'")}\``).join('\n') || 'Nothing to run.', r.errors.length ? `\nFailed:\n${r.errors.join('\n')}` : ''].join(''));
  },
};
