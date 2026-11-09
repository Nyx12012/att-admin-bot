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

function assertRecipe({ commands, give, buff, trigger, consume, cooldown }) {
  if (commands.length === 0 && !give && !buff) throw new UserError('Give it at least one command, a gives item or a buff.');
  if (trigger === 'pockets' && !consume && !cooldown) throw new UserError('This fires on every inventory change. Use up the items or set a cooldown, or make it fire on hands together.');
}

const COMMAND_OPTS = ['command', 'command2', 'command3', 'command4', 'command5'];
const RECIPE_ONLY = ['delete_items', ...COMMAND_OPTS, 'gives', 'gives_amount', 'trigger', 'any_order', 'cooldown', 'delay', 'aoe', 'aoe_caster', 'buff_seconds'];
const HOLD_ONLY = ['where', 'string'];
const CLEARS = {
  recipe: ['commands', ...COMMAND_OPTS, 'gives', 'buff', 'cooldown', 'delay', 'whitelist', 'message'],
  hold: ['whitelist', 'message', 'string'],
};
const EDIT_OPTS = ['items', ...RECIPE_ONLY, ...HOLD_ONLY, 'whitelist', 'message', 'buff_stat', 'buff_value', 'buff_multiply', 'clear'];

function clears(ctx, kind) {
  const list = String(ctx.opt('clear') || '').toLowerCase().split(/[\s,;]+/).filter(Boolean);
  for (const word of list) {
    if (!CLEARS[kind].includes(word)) throw new UserError(`"${word.slice(0, 30)}" cannot be cleared on this. Use: ${CLEARS[kind].join(', ')}.`);
  }
  return new Set(list);
}

function refuseOthers(ctx, opts, what) {
  const bad = opts.filter((k) => ctx.opt(k) != null);
  if (bad.length) throw new UserError(`${bad.join(', ')} only work on ${what}.`);
}

function statName(text) {
  if (!Alchemy.STAT.test(text)) throw new UserError(`"${text}" is not a stat name.`);
  return text;
}

function shared(ctx, next, gone) {
  if (gone.has('whitelist')) next.whitelist = [];
  if (gone.has('message')) next.text = null;
  if (ctx.opt('whitelist') != null) next.whitelist = whitelist(ctx.opt('whitelist'));
  if (ctx.opt('message') != null) next.text = cleanText(ctx.opt('message'), 120);
}

function editRecipe(ctx, r) {
  refuseOthers(ctx, HOLD_ONLY, 'item buffs');
  const gone = clears(ctx, 'recipe');
  const next = { ...r };
  shared(ctx, next, gone);
  const lines = gone.has('commands') ? [] : [...r.commands];
  COMMAND_OPTS.forEach((k, i) => {
    if (gone.has(k)) lines[i] = null;
    if (ctx.opt(k) != null) lines[i] = Alchemy.checkCommand(ctx.opt(k));
  });
  next.commands = lines.filter(Boolean);
  if (ctx.opt('items') != null) next.slots = Alchemy.parseSlots(ctx.opt('items'));
  if (ctx.opt('any_order') != null) next.ordered = !ctx.opt('any_order');
  if (ctx.opt('trigger') != null) next.trigger = ctx.opt('trigger');
  if (ctx.opt('delete_items') != null) next.consume = ctx.opt('delete_items');
  if (gone.has('cooldown')) next.cooldown = 0;
  if (gone.has('delay')) next.delay = 0;
  if (ctx.opt('cooldown') != null) next.cooldown = ctx.opt('cooldown');
  if (ctx.opt('delay') != null) next.delay = ctx.opt('delay');
  if (ctx.opt('aoe') != null) next.aoe = ctx.opt('aoe');
  if (ctx.opt('aoe_caster') != null) next.aoeCaster = ctx.opt('aoe_caster');
  if (gone.has('gives')) next.give = null;
  if (ctx.opt('gives') != null) {
    const gives = items.resolve(ctx.opt('gives'));
    if (!gives) throw new UserError(`No item matches "${ctx.opt('gives')}".`);
    next.give = { hash: gives.hash, count: next.give ? next.give.count : 1 };
  }
  if (ctx.opt('gives_amount') != null) {
    if (!next.give) throw new UserError('This recipe gives nothing yet. Set gives too.');
    next.give = { ...next.give, count: ctx.opt('gives_amount') };
  }
  if (gone.has('buff')) next.buff = null;
  const buffing = ['buff_stat', 'buff_value', 'buff_seconds', 'buff_multiply'].some((k) => ctx.opt(k) != null);
  if (buffing) {
    const buff = { seconds: 60, multiply: false, ...(next.buff || {}) };
    if (ctx.opt('buff_stat') != null) buff.stat = statName(ctx.opt('buff_stat'));
    if (ctx.opt('buff_value') != null) buff.value = ctx.opt('buff_value');
    if (ctx.opt('buff_seconds') != null) buff.seconds = ctx.opt('buff_seconds');
    if (ctx.opt('buff_multiply') != null) buff.multiply = ctx.opt('buff_multiply');
    if (!buff.stat) throw new UserError('Set buff_stat too.');
    if (buff.value == null) throw new UserError('Set buff_value too.');
    next.buff = buff;
  }
  assertRecipe(next);
  return next;
}

function editHold(ctx, h) {
  refuseOthers(ctx, RECIPE_ONLY, 'recipes');
  const gone = clears(ctx, 'hold');
  const next = { ...h, stats: h.stats.map((b) => ({ ...b })) };
  shared(ctx, next, gone);
  if (ctx.opt('items') != null) {
    const item = items.resolve(ctx.opt('items'));
    if (!item) throw new UserError(`No item matches "${ctx.opt('items')}".`);
    next.hash = item.hash;
  }
  if (ctx.opt('where') != null) next.where = ctx.opt('where');
  if (ctx.opt('buff_stat') != null) next.stats[0].stat = statName(ctx.opt('buff_stat'));
  if (ctx.opt('buff_value') != null) next.stats[0].value = ctx.opt('buff_value');
  if (ctx.opt('buff_multiply') != null) next.stats[0].multiply = ctx.opt('buff_multiply');
  if (gone.has('string')) next.print = null;
  if (ctx.opt('string') != null) {
    try {
      next.print = Alchemy.blueprint(ctx.opt('string'));
    } catch (e) {
      throw new UserError(`That save string could not be read: ${e.message}`);
    }
  }
  return next;
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
    .addSubcommand((s) => {
      const b = ruleName(s.setName('edit').setDescription('Change a saved recipe or item buff, only what you set changes'));
      addText(b, 'items', 'Recipe: the pocket items, split by commas. Item buff: the item', { required: false, max: 200 });
      addBool(b, 'delete_items', 'Use the items up when it fires', { required: false });
      addText(b, 'command', 'Command number 1', { required: false, max: 300 });
      for (const n of [2, 3, 4, 5]) addText(b, `command${n}`, `Command number ${n}`, { required: false, max: 300 });
      addItem(b, { required: false, name: 'gives', description: 'Item to give, to the mailbox with BotCore' });
      addInt(b, 'gives_amount', 'How many to give', { required: false, min: 1, max: 25 });
      addChoice(b, 'trigger', 'When it fires', [{ name: 'hands together', value: 'hands' }, { name: 'as soon as the items are in place', value: 'pockets' }], { required: false });
      addBool(b, 'any_order', 'Pockets can be in any order', { required: false });
      addInt(b, 'cooldown', 'Seconds before a player can use it again', { required: false, min: 0, max: 86400 });
      addInt(b, 'delay', 'Seconds between commands', { required: false, min: 0, max: 60 });
      addText(b, 'whitelist', 'Only these in-game names can use it, split by commas', { required: false, max: 200 });
      addBool(b, 'aoe', 'Run on everyone in the chunk of the caster', { required: false });
      addBool(b, 'aoe_caster', 'With aoe: the caster is included too', { required: false });
      addText(b, 'message', 'Text shown to the caster', { required: false, max: 120 });
      addName(b, 'buff_stat', 'Stat to buff, like speed or damage', { required: false, auto: true, max: 40 });
      addNumber(b, 'buff_value', 'How much to add', { required: false, min: -100, max: 100 });
      addInt(b, 'buff_seconds', 'How long the buff lasts', { required: false, min: 1, max: 86400 });
      addBool(b, 'buff_multiply', 'Multiply the stat instead of adding', { required: false });
      addChoice(b, 'where', 'Item buff: where they must carry it', [{ name: 'in a hand', value: 'hand' }, { name: 'in a hand or front pocket', value: 'pocket' }, { name: 'anywhere on them', value: 'any' }], { required: false });
      addText(b, 'string', 'Item buff: only an item built like this save string counts', { required: false, max: 6000 });
      return addText(b, 'clear', 'Remove parts, split by commas: commands, command2, gives, buff, cooldown, whitelist, message, string', { required: false, max: 120 });
    })
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
    if (focused.name === 'gives') return items.search(q, {}).map((i) => ({ name: `${i.name} (${i.hash})`, value: String(i.hash) }));
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
      assertRecipe({ commands, give: gives, buff: buffStat, trigger: ctx.opt('trigger'), consume: ctx.opt('delete_items'), cooldown: ctx.opt('cooldown') });
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
    if (ctx.sub === 'edit') {
      if (!EDIT_OPTS.some((k) => ctx.opt(k) != null)) throw new UserError('Nothing to change. Set at least one option.');
      const text = recipe ? describe(al.makeRecipe(s, editRecipe(ctx, recipe))) : describeHold(al.makeHold(s, editHold(ctx, hold)));
      ctx.note(`${key}: ${text}`);
      return ctx.ok(`${key} updated`, text);
    }
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
