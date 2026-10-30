const { SlashCommandBuilder } = require('discord.js');
const { addPlayer, addName, addText } = require('../core/opts');
const { UserError, safeKey, own } = require('../game/text');

const before = new Map();

function parse(text) {
  const out = {};
  for (const part of String(text).split(/[,;\n]+/).map((x) => x.trim()).filter(Boolean)) {
    const m = part.match(/^([A-Za-z-]{2,40})\s*[:= ]\s*(-?\d+(?:\.\d+)?)$/);
    if (!m) throw new UserError(`Cannot read "${part}". Write it like "speed 3".`);
    out[m[1].toLowerCase()] = Number(m[2]);
  }
  if (Object.keys(out).length === 0) throw new UserError('List at least one stat, like "speed 3, damage 2".');
  return out;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('buff')
    .setDescription('Saved sets of stats to hand out')
    .addSubcommand((s) => addText(addName(s.setName('create').setDescription('Make or replace a buff'), 'name', 'Buff name'), 'stats', 'Like: speed 3, damage 2, damageprotection 3', { max: 400 }))
    .addSubcommand((s) => addName(addPlayer(s.setName('give').setDescription('Apply a buff to a player')), 'buff', 'Which buff', { auto: true }))
    .addSubcommand((s) => addPlayer(s.setName('clear').setDescription('Put back the stats from before the last buff')))
    .addSubcommand((s) => s.setName('list').setDescription('Every buff'))
    .addSubcommand((s) => addName(s.setName('delete').setDescription('Delete a buff'), 'buff', 'Which buff', { auto: true })),
  access: 'admin',

  async run(ctx) {
    const s = ctx.needServer();
    const buffs = ctx.data('buffs', {});
    if (ctx.sub === 'list') {
      const lines = Object.entries(buffs).map(([k, b]) => `**${k}**: ${Object.entries(b.stats).map(([n, v]) => `${n} ${v}`).join(', ')}`);
      return ctx.info('Buffs', lines.join('\n') || 'No buffs yet.');
    }
    if (ctx.sub === 'create') {
      const key = safeKey(ctx.opt('name'));
      buffs[key] = { stats: parse(ctx.opt('stats')), by: ctx.user.tag };
      ctx.save('buffs');
      return ctx.ok('Buff saved', `**${key}**: ${Object.entries(buffs[key].stats).map(([n, v]) => `${n} ${v}`).join(', ')}`);
    }
    if (ctx.sub === 'delete') {
      const key = String(ctx.opt('buff')).toLowerCase();
      if (!own(buffs, key)) throw new UserError(`No buff called "${key}".`);
      delete buffs[key];
      ctx.save('buffs');
      return ctx.ok('Buff deleted', key);
    }
    ctx.needOnline();
    const name = ctx.player();
    const memo = `${s.id}:${name.toLowerCase()}`;
    if (ctx.sub === 'clear') {
      const old = before.get(memo);
      if (!old) throw new UserError(`No buff was given to ${name} since the bot started.`);
      const failed = [];
      for (const [stat, value] of Object.entries(old)) {
        try {
          await s.setStat(name, stat, value);
          delete old[stat];
        } catch (e) {
          failed.push(stat);
        }
      }
      if (failed.length) return ctx.warn('Partly cleared', `Could not put back: ${failed.join(', ')}. Run /buff clear again.`);
      before.delete(memo);
      return ctx.ok('Buff cleared', `${name} has their old stats back.`);
    }
    const key = String(ctx.opt('buff')).toLowerCase();
    const buff = own(buffs, key);
    if (!buff) throw new UserError(`No buff called "${key}".`);
    const snapshot = before.get(memo) || {};
    before.set(memo, snapshot);
    const done = [];
    for (const [stat, value] of Object.entries(buff.stats)) {
      const cur = await s.stat(name, stat).catch(() => null);
      if (!cur) {
        done.push(`${stat}: no such stat`);
        continue;
      }
      if (!(cur.name in snapshot)) snapshot[cur.name] = cur.base;
      const v = Math.max(cur.min, Math.min(cur.max, value));
      await s.setStat(name, cur.name, v);
      done.push(`${cur.name} ${v}`);
    }
    ctx.note(`${key} to ${name}`);
    return ctx.ok(`Buff ${key} given to ${name}`, `${done.join('\n')}\n\nUndo with \`/buff clear\`.`);
  },
};
