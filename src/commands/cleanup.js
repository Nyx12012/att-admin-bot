const { SlashCommandBuilder } = require('discord.js');
const { addName, addText, addInt, addNumber, addBool, addChoice, addItem } = require('../core/opts');
const items = require('../core/items');
const Cleanup = require('../features/cleanup');
const { UserError } = require('../game/text');
const { minutes, stamp } = require('../core/ui');

const PRESET_CHOICES = Object.entries(Cleanup.PRESETS).map(([value, p]) => ({ name: `${value}: ${p.label}`.slice(0, 100), value }));

function rule(s) {
  return addName(s, 'rule', 'Rule name', { auto: true });
}

function parseItems(text) {
  const out = [];
  for (const part of String(text).split(/[,;\n]+/).map((x) => x.trim()).filter(Boolean)) {
    const item = items.resolve(part);
    if (!item) throw new UserError(`No item matches "${part}". Use exact names like "Spriggull Feather Red" or prefab hashes.`);
    out.push(item.hash);
  }
  if (out.length === 0) throw new UserError('List at least one item.');
  return out;
}

function describe(cleanup, r) {
  const last = r.result ? `${stamp(r.result.at)}: ${r.result.dry ? `${r.result.found} would go` : `${r.result.removed} removed`}` : 'not run yet';
  return [
    `**${r.name}** ${r.on ? '' : '(paused) '}${r.mode === 'live' ? 'LIVE' : 'preview'}, every ${minutes(r.every)}${r.min ? `, only above ${r.min}` : ''}`,
    `${cleanup.names(r.items)}`,
    `Last run ${last}`,
  ].join('\n');
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('cleanup')
    .setDescription('Clear items that pile up on the ground, on a timer')
    .addSubcommand((s) => s.setName('list').setDescription('Every rule and the cleanup settings'))
    .addSubcommand((s) => addInt(addInt(addChoice(s.setName('preset').setDescription('Add a ready made rule'), 'preset', 'Which set of items', PRESET_CHOICES), 'every', 'Minutes between runs (default 30)', { required: false, min: 5, max: 1440 }), 'above', 'Only clean when more than this many are found', { required: false, min: 0, max: 10000 }))
    .addSubcommand((s) => addInt(addInt(addText(addName(s.setName('add').setDescription('Make your own rule'), 'name', 'Rule name'), 'items', 'Item names or hashes, comma separated', { max: 1000 }), 'every', 'Minutes between runs (default 30)', { required: false, min: 5, max: 1440 }), 'above', 'Only clean when more than this many are found', { required: false, min: 0, max: 10000 }))
    .addSubcommand((s) => rule(s.setName('remove').setDescription('Delete a rule')))
    .addSubcommand((s) => addChoice(rule(s.setName('mode').setDescription('Preview only counts, live really deletes')), 'mode', 'Mode', [{ name: 'preview (count only)', value: 'preview' }, { name: 'live (delete items)', value: 'live' }]))
    .addSubcommand((s) => addInt(rule(s.setName('every').setDescription('How often a rule runs')), 'minutes', 'Minutes between runs', { min: 5, max: 1440 }))
    .addSubcommand((s) => addInt(rule(s.setName('above').setDescription('Only clean when more than this many are on the ground')), 'count', '0 cleans every time', { min: 0, max: 10000 }))
    .addSubcommand((s) => addBool(rule(s.setName('pause').setDescription('Pause or resume one rule')), 'paused', 'Paused?'))
    .addSubcommand((s) => rule(s.setName('preview').setDescription('Count what a rule would remove right now')))
    .addSubcommand((s) => rule(s.setName('run').setDescription('Run a rule now (asks first when it is live)')))
    .addSubcommand((s) => addItem(s.setName('sweep').setDescription('Remove one item type from the ground right now, asks first'), { description: 'The item' }))
    .addSubcommand((s) => addInt(addBool(s.setName('warning').setDescription('Warn players in game before a live cleanup'), 'on', 'On or off'), 'seconds', 'Warning time (default 60)', { required: false, min: 10, max: 300 }))
    .addSubcommand((s) => addNumber(s.setName('decay').setDescription("The game's own rot speed for every loose item"), 'multiplier', '1 is normal, 0.5 rots twice as fast, empty shows it', { required: false, min: 0.05, max: 10 }))
    .addSubcommand((s) => addBool(s.setName('auto').setDescription('Turn the timer for all rules on or off'), 'on', 'On or off')),
  access: { list: 'admin', preview: 'admin', '*': 'admin' },

  async run(ctx) {
    const s = ctx.needServer();
    const c = ctx.bot.cleanup;
    const d = c.doc(s);
    switch (ctx.sub) {
      case 'list': {
        const rules = Object.values(d.rules);
        return ctx.info('Cleanup', [
          `Timer: **${d.enabled ? 'on' : 'off'}**  Warning: **${d.warning.on ? `on, ${d.warning.seconds} s` : 'off'}**`,
          'Only loose items are removed. Held items and anything in bags, belts or storage slots are never touched. Items resting on shelves, tables or in open crates count as loose.',
          '',
          rules.length ? rules.map((r) => describe(c, r)).join('\n\n') : 'No rules yet. Start with `/cleanup preset`.',
        ].join('\n'));
      }
      case 'preset': {
        const name = ctx.opt('preset');
        const p = Cleanup.PRESETS[name];
        const r = c.addRule(s, name, p.items, { every: ctx.opt('every') || 30, min: ctx.opt('above') || 0, preset: name });
        ctx.note(`${name} every ${r.every}`);
        return ctx.ok('Rule added', `${describe(c, r)}\n\nNew rules start in **preview** mode: they only count and report. When the numbers look right, use \`/cleanup mode rule:${r.name} mode:live\`.`);
      }
      case 'add': {
        const r = c.addRule(s, ctx.opt('name'), parseItems(ctx.opt('items')), { every: ctx.opt('every') || 30, min: ctx.opt('above') || 0 });
        ctx.note(`${r.name}: ${r.items.join(',')}`);
        return ctx.ok('Rule added', `${describe(c, r)}\n\nNew rules start in **preview** mode. Switch with \`/cleanup mode\`.`);
      }
      case 'remove':
        if (!c.removeRule(s, ctx.opt('rule'))) throw new UserError(`No rule called "${ctx.opt('rule')}".`);
        ctx.note(ctx.opt('rule'));
        return ctx.ok('Rule removed', ctx.opt('rule'));
      case 'mode': {
        const r = c.rule(s, ctx.opt('rule'));
        r.mode = ctx.opt('mode');
        c.save(s);
        ctx.note(`${r.name} ${r.mode}`);
        return ctx.ok('Mode changed', r.mode === 'live' ? `**${r.name}** is live: it deletes loose items every ${minutes(r.every)}.` : `**${r.name}** only counts now.`);
      }
      case 'every': {
        const r = c.rule(s, ctx.opt('rule'));
        r.every = ctx.opt('minutes');
        c.save(s);
        return ctx.ok('Timer changed', `**${r.name}** runs every ${minutes(r.every)}.`);
      }
      case 'above': {
        const r = c.rule(s, ctx.opt('rule'));
        r.min = ctx.opt('count');
        c.save(s);
        return ctx.ok('Threshold changed', r.min ? `**${r.name}** only cleans when more than ${r.min} are on the ground.` : `**${r.name}** cleans every time.`);
      }
      case 'pause': {
        const r = c.rule(s, ctx.opt('rule'));
        r.on = !ctx.opt('paused');
        c.save(s);
        return ctx.ok(r.on ? 'Rule resumed' : 'Rule paused', r.name);
      }
      case 'warning':
        d.warning.on = ctx.opt('on');
        if (ctx.opt('seconds')) d.warning.seconds = ctx.opt('seconds');
        c.save(s);
        ctx.note(`${d.warning.on} ${d.warning.seconds}`);
        return ctx.ok('Warning', d.warning.on ? `Players get a ${d.warning.seconds} second warning in game before a live cleanup.` : 'No warning before cleanups.');
      case 'auto':
        d.enabled = ctx.opt('on');
        c.save(s);
        return ctx.ok('Cleanup timer', d.enabled ? 'Rules run on their timers.' : 'Timer stopped. Rules only run when you use /cleanup run.');
      case 'decay': {
        ctx.needOnline();
        const value = ctx.opt('multiplier');
        if (value == null) {
          const all = await ctx.bot.loadSettings(s);
          return ctx.info('Decay', `DecayMultiplier is **${all.DecayMultiplier}**. The game rots loose items on its own; lower numbers rot them faster.`);
        }
        await s.changeSetting('DecayMultiplier', String(value));
        ctx.note(String(value));
        return ctx.ok('Decay changed', `DecayMultiplier is now **${value}**. Items already rotting keep their old timer.`);
      }
      default:
        break;
    }
    ctx.needOnline();
    if (ctx.sub === 'sweep') {
      const item = items.resolve(ctx.opt('item'));
      if (!item) throw new UserError(`No item matches "${ctx.opt('item')}".`);
      const counted = await c.sweepItems(s, [item.hash], { preview: true });
      if (counted.scan.nobody) return ctx.warn('Nobody online', 'Items only exist near players, so there is nothing loaded to clean.');
      if (counted.scan.total === 0) return ctx.info('Nothing to sweep', `No loose **${item.name}** on the ground near any player.`);
      if (!(await ctx.confirm(`Remove ${counted.scan.total} ${item.name}?`, `${counted.scan.total} loose on the ground. Held and stored ones stay.`, { label: 'Remove' }))) return null;
      const done = await c.sweepItems(s, [item.hash]);
      ctx.note(`${item.name}: ${done.removed}`);
      return ctx.ok('Swept', `${done.removed} **${item.name}** removed.`);
    }
    const r = c.rule(s, ctx.opt('rule'));
    if (ctx.sub === 'preview') {
      const res = await c.runRule(s, r, { preview: true });
      if (res.nobody) return ctx.warn('Nobody online', 'Items only exist near players, so there is nothing loaded to count.');
      return ctx.info(`Preview: ${r.name}`, res.detail);
    }
    if (r.mode === 'live') {
      const counted = await c.sweepItems(s, r.items, { preview: true });
      if (counted.scan.nobody) return ctx.warn('Nobody online', 'Nothing is loaded.');
      if (counted.scan.total === 0) return ctx.info(`Nothing to clean for ${r.name}`, 'No loose items found.');
      if (!(await ctx.confirm(`Run ${r.name} now?`, c.summary(counted.scan, 'will be removed'), { label: 'Clean' }))) return null;
    }
    const res = await c.runRule(s, r);
    ctx.note(`${r.name}: ${res.dry ? `preview ${res.found}` : `removed ${res.removed}`}`);
    if (res.nobody) return ctx.warn('Nobody online', 'Nothing is loaded.');
    return (res.dry ? ctx.info : ctx.ok).call(ctx, res.dry ? `Preview: ${r.name}` : `Cleaned: ${r.name}`, res.detail);
  },
};
