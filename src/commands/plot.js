const { SlashCommandBuilder } = require('discord.js');
const { addPlayer, addName, addChoice, addBool } = require('../core/opts');
const { UserError, isSafeName, chunkName, own } = require('../game/text');
const { AREAS } = require('../game/server');

function plot(s) {
  return addName(s, 'plot', 'Plot name', { auto: true });
}

function nameOpt(s, description) {
  return s.addStringOption((o) => o.setName('name').setDescription(description).setRequired(true).setMaxLength(32).setAutocomplete(true));
}

function info(p) {
  return [
    `Owner: **${p.owner}**`,
    `Chunks: ${p.chunks.join(', ')}`,
    `Trusted: ${p.trusted.length ? p.trusted.join(', ') : 'nobody'}`,
    `Intruders: ${p.mode === 'eject' ? 'sent out' : p.mode === 'warn' ? 'warned only' : 'ignored'} (exit: ${p.exit.point ? p.exit.label || 'saved location' : p.exit.area})`,
  ].join('\n');
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('plot')
    .setDescription('Land claims: keep other players out of a base')
    .addSubcommand((s) => addPlayer(addName(s.setName('create').setDescription('Claim the chunk a player stands in for them'), 'name', 'Plot name'), { description: 'Owner, standing in the chunk' }))
    .addSubcommand((s) => addPlayer(plot(s.setName('grow').setDescription('Add the chunk a player stands in')), { description: 'Player standing in the chunk' }))
    .addSubcommand((s) => addName(plot(s.setName('shrink').setDescription('Remove a chunk from a plot')), 'chunk', 'Chunk like 21-34', { max: 12 }))
    .addSubcommand((s) => plot(s.setName('delete').setDescription('Delete a plot')))
    .addSubcommand((s) => s.setName('list').setDescription('Every plot'))
    .addSubcommand((s) => plot(s.setName('info').setDescription('Details of a plot')))
    .addSubcommand((s) => nameOpt(plot(s.setName('trust').setDescription('Let a player into a plot (plot owner or admin)')), 'In-game name'))
    .addSubcommand((s) => nameOpt(plot(s.setName('untrust').setDescription('Take a player off a plot (plot owner or admin)')), 'In-game name'))
    .addSubcommand((s) => addChoice(plot(s.setName('mode').setDescription('What happens to intruders')), 'mode', 'Mode', [{ name: 'send them out', value: 'eject' }, { name: 'warn only', value: 'warn' }, { name: 'off', value: 'off' }]))
    .addSubcommand((s) => plot(s.setName('exit').setDescription('Where intruders are sent'))
      .addStringOption((o) => o.setName('area').setDescription('Named spot, like RespawnPoint').setRequired(false).setAutocomplete(true))
      .addStringOption((o) => o.setName('location').setDescription('Or a location from /location').setRequired(false).setAutocomplete(true)))
    .addSubcommand((s) => addPlayer(s.setName('where').setDescription('Which chunk and plot a player is in')))
    .addSubcommand((s) => addBool(s.setName('enforce').setDescription('Turn plot protection on or off for the whole server'), 'on', 'On or off'))
    .addSubcommand((s) => nameOpt(s.setName('staff').setDescription('Players allowed in every plot, like admins'), 'In-game name')
      .addBooleanOption((o) => o.setName('allowed').setDescription('Add (true) or remove (false)').setRequired(true))),
  access: { list: 'everyone', info: 'everyone', trust: 'everyone', untrust: 'everyone', '*': 'admin' },

  async autocomplete(ctx, focused) {
    if (!ctx.server) return [];
    const q = String(focused.value).toLowerCase();
    if (focused.name === 'plot') return Object.keys(ctx.bot.plots.doc(ctx.server)).filter((k) => k.includes(q));
    if (focused.name === 'name') {
      if (ctx.sub === 'untrust') {
        const p = own(ctx.bot.plots.doc(ctx.server), String(ctx.opt('plot')).toLowerCase());
        return p ? p.trusted.filter((t) => t.toLowerCase().includes(q)) : [];
      }
      if (ctx.sub === 'staff') return ctx.bot.plots.settings(ctx.server).staff.concat(ctx.server.players().map((p) => p.username)).filter((n) => n.toLowerCase().includes(q));
      return ctx.server.players().map((p) => p.username).filter((n) => n.toLowerCase().includes(q));
    }
    return [];
  },

  async run(ctx) {
    const s = ctx.needServer();
    const plots = ctx.bot.plots;
    if (ctx.sub === 'list') {
      const list = Object.values(plots.doc(s));
      return ctx.info(`Plots: ${list.length}`, list.map((p) => `**${p.name}** (${p.owner}) ${p.chunks.length} chunk(s)`).join('\n') || 'No plots yet.');
    }
    if (ctx.sub === 'enforce') {
      plots.settings(s).enforce = ctx.opt('on');
      plots.saveSettings(s);
      return ctx.ok('Plot protection', ctx.opt('on') ? 'On.' : 'Off. Plots are kept but nobody is warned or sent out.');
    }
    if (ctx.sub === 'staff') {
      const name = String(ctx.opt('name')).trim();
      if (!isSafeName(name)) throw new UserError('That is not a valid in-game name.');
      const st = plots.settings(s);
      st.staff = st.staff.filter((x) => x.toLowerCase() !== name.toLowerCase());
      if (ctx.opt('allowed')) st.staff.push(name);
      plots.saveSettings(s);
      return ctx.ok('Plot staff', `Allowed in every plot: ${st.staff.join(', ') || 'nobody'}`);
    }
    if (ctx.sub === 'where') {
      ctx.needOnline();
      const name = ctx.player();
      const { chunk } = await s.position(name);
      const p = plots.at(s, chunk);
      return ctx.info(name, `Chunk **${chunk}**${p ? `, inside the plot **${p.name}** (${p.owner})` : ', not in a plot'}.`);
    }
    if (ctx.sub === 'create') {
      ctx.needOnline();
      const owner = ctx.player();
      const { chunk } = await s.position(owner);
      if (!chunk) throw new UserError(`Could not read the chunk ${owner} is in.`);
      const p = plots.create(s, ctx.opt('name'), owner, chunk);
      ctx.note(`${p.name} for ${owner} at ${chunk}`);
      return ctx.ok('Plot created', `${info(p)}\n\nGrow it with \`/plot grow\` while someone stands in the next chunk.`);
    }
    const p = plots.get(s, ctx.opt('plot'));
    if (ctx.sub === 'info') return ctx.info(`Plot ${p.name}`, info(p));
    if (ctx.sub === 'trust' || ctx.sub === 'untrust') {
      if (!plots.canManage(ctx, p)) throw new UserError(`Only ${p.owner} (linked with /link) or an admin can change who is trusted on ${p.name}.`);
      const name = String(ctx.opt('name')).trim();
      if (!isSafeName(name)) throw new UserError('That is not a valid in-game name.');
      p.trusted = p.trusted.filter((x) => x.toLowerCase() !== name.toLowerCase());
      if (ctx.sub === 'trust') p.trusted.push(name);
      plots.save(s);
      ctx.note(`${p.name} ${ctx.sub} ${name}`);
      return ctx.ok(ctx.sub === 'trust' ? 'Trusted' : 'Untrusted', `${name} ${ctx.sub === 'trust' ? 'can enter' : 'can no longer enter'} ${p.name}.`);
    }
    if (ctx.sub === 'grow') {
      ctx.needOnline();
      const who = ctx.player();
      const { chunk } = await s.position(who);
      const c = plots.addChunk(s, p, chunk);
      ctx.note(`${p.name} + ${c}`);
      return ctx.ok('Plot grown', `${p.name} now covers ${p.chunks.join(', ')}.`);
    }
    if (ctx.sub === 'shrink') {
      const c = chunkName(ctx.opt('chunk'));
      if (!p.chunks.includes(c)) throw new UserError(`${p.name} does not cover chunk ${c}.`);
      if (p.chunks.length === 1) throw new UserError('That is the last chunk. Use /plot delete instead.');
      p.chunks = p.chunks.filter((x) => x !== c);
      plots.save(s);
      return ctx.ok('Plot shrunk', `${p.name} now covers ${p.chunks.join(', ')}.`);
    }
    if (ctx.sub === 'delete') {
      delete plots.doc(s)[p.name];
      plots.save(s);
      ctx.note(p.name);
      return ctx.ok('Plot deleted', p.name);
    }
    if (ctx.sub === 'mode') {
      p.mode = ctx.opt('mode');
      plots.save(s);
      return ctx.ok('Plot mode', `${p.name}: ${p.mode}.`);
    }
    const area = ctx.opt('area');
    const loc = ctx.opt('location');
    if (loc) {
      const saved = ctx.data('locations', {})[String(loc).toLowerCase()];
      if (!saved) throw new UserError(`No saved location "${loc}".`);
      p.exit = { point: saved.pos, label: String(loc).toLowerCase() };
    } else {
      const hit = AREAS.find((a) => a.toLowerCase() === String(area || '').toLowerCase());
      if (!hit) throw new UserError('Pick an area or a saved location.');
      p.exit = { area: hit };
    }
    plots.save(s);
    return ctx.ok('Exit set', `Intruders of ${p.name} go to ${p.exit.label || p.exit.area}.`);
  },
};
