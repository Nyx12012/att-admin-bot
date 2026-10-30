const { SlashCommandBuilder } = require('discord.js');
const { addName } = require('../core/opts');
const { UserError } = require('../game/text');

const NOTES = {
  DecayMultiplier: 'How fast loose items rot away. Lower = faster, 0.5 is twice as fast.',
  DropAllOnDeath: 'Drop the whole inventory on death.',
  DownedStateDuration: 'Seconds a downed player waits before dying. 0 = no downed state.',
  RespawnTimeSeconds: 'Seconds before respawning.',
  IsPVPEnabled: 'Players can hurt each other.',
  PVPMultiplier: 'Damage between players.',
  PlayerLimit: 'Max players, -1 = no limit.',
  SpawningRateMultiplier: 'How fast creatures respawn.',
  TimeSpeedMultiplier: 'How fast the day goes by.',
  FixedDaytime: 'Freeze the time of day, -1 = off.',
  XPX: 'Experience multiplier for every skill.',
  HungerTick: 'How fast hunger drains.',
  HasAFKTimer: 'Kick players who stay idle.',
  EmptyServerShutdownTimeInSeconds: 'Shut down after being empty this long.',
};

function parseValue(current, raw) {
  const v = String(raw).trim();
  if (typeof current === 'boolean') {
    if (/^(true|on|yes|1)$/i.test(v)) return 'true';
    if (/^(false|off|no|0)$/i.test(v)) return 'false';
    throw new UserError('This setting is on or off: use true or false.');
  }
  if (typeof current === 'number') {
    const n = Number(v);
    if (!Number.isFinite(n)) throw new UserError('This setting takes a number.');
    return String(n);
  }
  if (!/^[A-Za-z0-9_.-]{1,30}$/.test(v)) throw new UserError('That value has characters the console cannot take.');
  return v;
}

function show(v) {
  return typeof v === 'object' ? JSON.stringify(v) : String(v);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('settings')
    .setDescription('Read and change the server settings')
    .addSubcommand((s) => s.setName('show').setDescription('Every setting and its value'))
    .addSubcommand((s) => addName(s.setName('get').setDescription('One setting'), 'setting', 'Setting name', { auto: true, max: 60 }))
    .addSubcommand((s) => addName(addName(s.setName('set').setDescription('Change a setting (owner only by default)'), 'setting', 'Setting name', { auto: true, max: 60 }), 'value', 'New value', { max: 30 })),
  access: { set: 'owner', '*': 'admin' },

  async autocomplete(ctx, focused) {
    if (!ctx.server || !ctx.server.online) return [];
    const names = ctx.bot.settingNames(ctx.server).length ? ctx.bot.settingNames(ctx.server) : Object.keys(await ctx.bot.loadSettings(ctx.server, 2500));
    const q = String(focused.value).toLowerCase();
    return names.filter((n) => n.toLowerCase().includes(q)).sort();
  },

  async run(ctx) {
    const s = ctx.needOnline();
    const all = await ctx.bot.loadSettings(s);
    if (ctx.sub === 'show') {
      const lines = Object.entries(all).map(([k, v]) => `\`${k}\` ${show(v)}`);
      const half = Math.ceil(lines.length / 2);
      return ctx.info(`${s.name}: settings`, 'Change one with `/settings set`.', [['', lines.slice(0, half).join('\n'), true], ['', lines.slice(half).join('\n'), true]]);
    }
    const key = Object.keys(all).find((k) => k.toLowerCase() === String(ctx.opt('setting')).toLowerCase());
    if (!key) throw new UserError(`There is no setting called "${ctx.opt('setting')}".`);
    if (ctx.sub === 'get') {
      return ctx.info(key, `${show(all[key])}${NOTES[key] ? `\n${NOTES[key]}` : ''}`);
    }
    const value = parseValue(all[key], ctx.opt('value'));
    await s.changeSetting(key, value);
    const after = await ctx.bot.loadSettings(s);
    ctx.note(`${key}: ${show(all[key])} to ${show(after[key])}`);
    return ctx.ok('Setting changed', `\`${key}\` ${show(all[key])} to **${show(after[key])}**${NOTES[key] ? `\n${NOTES[key]}` : ''}`);
  },
};
