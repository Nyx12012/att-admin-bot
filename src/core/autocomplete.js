const items = require('./items');
const { AREAS } = require('../game/server');
const targets = require('./targets');
const materials = require('./materials');

function matches(list, query) {
  const q = String(query || '').toLowerCase();
  const starts = list.filter((x) => x.toLowerCase().startsWith(q));
  const rest = list.filter((x) => !x.toLowerCase().startsWith(q) && x.toLowerCase().includes(q));
  return starts.concat(rest);
}

function keys(ctx, name) {
  if (!ctx.server) return [];
  const doc = ctx.bot.store.get(`server-${ctx.server.id}-${name}`, {});
  return Object.keys(doc).sort();
}

async function generic(ctx, focused) {
  const q = focused.value;
  switch (focused.name) {
    case 'player':
    case 'target':
      return ctx.server ? targets.choices(ctx.bot, ctx.server, q) : [];
    case 'item':
    case 'items':
      return items.search(q, { spawn: ctx.command && ctx.command.data.name === 'spawn' }).map((i) => ({ name: `${i.name} (${i.hash})`, value: String(i.hash) }));
    case 'material':
      return materials.search(q);
    case 'area':
      return matches(AREAS, q);
    case 'location':
      return matches(keys(ctx, 'locations'), q);
    case 'kit':
      return matches(keys(ctx, 'kits'), q);
    case 'buff':
      return matches(keys(ctx, 'buffs'), q);
    case 'plot':
      return matches(keys(ctx, 'plots'), q);
    case 'rule':
      return matches(Object.keys(ctx.server ? ctx.bot.cleanup.rules(ctx.server) : {}), q);
    case 'stat':
      return matches(ctx.bot.statNames(), q);
    case 'setting':
      return matches(ctx.bot.settingNames(ctx.server), q);
    default:
      return [];
  }
}

module.exports = { generic, matches };
