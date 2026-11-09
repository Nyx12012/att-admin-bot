const { SlashCommandBuilder } = require('discord.js');
const { addChoice, addName } = require('../core/opts');
const { UserError, own } = require('../game/text');
const { ago, list } = require('../core/ui');

const KINDS = [{ name: 'player kills', value: 'kills' }, { name: 'deaths', value: 'deaths' }, { name: 'creatures killed', value: 'creatures' }, { name: 'time online', value: 'seconds' }];

function played(seconds) {
  return ago(Date.now() - seconds * 1000);
}

function show(kind, row) {
  return kind === 'seconds' ? played(row.seconds) : String(row[kind]);
}

function nameOf(ctx) {
  const given = ctx.opt('player');
  if (given) return ctx.name('player');
  const link = ctx.bot.links.of(ctx.server, ctx.user.id);
  if (!link) throw new UserError('Pick a player, or use /link to see your own.');
  return link.username;
}

const stats = {
  data: new SlashCommandBuilder()
    .setName('stats')
    .setDescription('Kills, deaths and time online, counted since the bot started tracking')
    .addSubcommand((s) => addChoice(s.setName('top').setDescription('The leaderboard'), 'kind', 'What to rank', KINDS))
    .addSubcommand((s) => addName(s.setName('player').setDescription('One player'), 'player', 'In-game name, default you', { required: false, auto: true })),
  access: 'everyone',
  public: true,

  async run(ctx) {
    const s = ctx.needServer();
    const doc = ctx.bot.stats.doc(s);
    if (ctx.sub === 'top') {
      const kind = ctx.opt('kind');
      const rows = Object.values(doc.players).filter((r) => r[kind] > 0).sort((a, b) => b[kind] - a[kind]).slice(0, 15);
      const label = KINDS.find((k) => k.value === kind).name;
      return ctx.info(`Top: ${label}`, list(rows.map((r, i) => `${i + 1}. **${r.name}**: ${show(kind, r)}`), 'Nothing counted yet.'));
    }
    const name = nameOf(ctx);
    const row = own(doc.players, name.toLowerCase());
    if (!row) return ctx.info(name, 'Nothing counted yet.');
    return ctx.info(row.name, null, [['Player kills', String(row.kills), true], ['Deaths', String(row.deaths), true], ['Creatures killed', String(row.creatures), true], ['Time online', played(row.seconds), true]]);
  },
};

const playtime = {
  data: addName(new SlashCommandBuilder().setName('playtime').setDescription('How long a player has been online'), 'player', 'In-game name, default you', { required: false, auto: true }),
  access: 'everyone',
  public: true,

  async run(ctx) {
    const s = ctx.needServer();
    const name = nameOf(ctx);
    const row = own(ctx.bot.stats.doc(s).players, name.toLowerCase());
    return ctx.info(row ? row.name : name, row ? `${played(row.seconds)} online since the bot started counting.` : 'Nothing counted yet.');
  },
};

module.exports = [stats, playtime];
