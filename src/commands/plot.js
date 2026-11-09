const { SlashCommandBuilder } = require('discord.js');
const { addPlayer, addName, addChoice, addBool } = require('../core/opts');
const { UserError, isSafeName, chunkName, overworldChunk, own, vecText } = require('../game/text');
const { AREAS } = require('../game/server');
const targets = require('../core/targets');

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
    `Arrival spot: ${p.spawn ? vecText(p.spawn) : 'not set yet, it fills in when the owner walks in'}`,
  ].join('\n');
}

function treeText(tree) {
  return tree ? `The plot tree is chunk ${tree.chunk}.` : 'The plot tree is off.';
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('plot')
    .setDescription('Land claims: keep other players out of a base')
    .addSubcommand((s) => addPlayer(addName(s.setName('create').setDescription('Claim the chunk a player stands in for them'), 'name', 'Plot name'), { description: 'Owner, standing in the chunk' }))
    .addSubcommand((s) => addName(addName(addName(s.setName('claim').setDescription('Claim chunks by list, nobody has to stand there'), 'name', 'Plot name'), 'owner', 'In-game name of the owner'), 'chunks', 'Chunks like 15-28,16-28', { max: 200 }))
    .addSubcommand((s) => addPlayer(plot(s.setName('grow').setDescription('Add the chunk a player stands in')), { description: 'Player standing in the chunk' }))
    .addSubcommand((s) => addName(plot(s.setName('shrink').setDescription('Remove a chunk from a plot')), 'chunk', 'Chunk like 21-34', { max: 12 }))
    .addSubcommand((s) => plot(s.setName('delete').setDescription('Delete a plot')))
    .addSubcommand((s) => s.setName('deleteall').setDescription('Delete every plot on this server'))
    .addSubcommand((s) => s.setName('list').setDescription('Every plot'))
    .addSubcommand((s) => s.setName('map').setDescription('A map of every plot'))
    .addSubcommand((s) => plot(s.setName('info').setDescription('Details of a plot')))
    .addSubcommand((s) => nameOpt(plot(s.setName('trust').setDescription('Let a player into a plot (plot owner or admin)')), 'In-game name'))
    .addSubcommand((s) => nameOpt(plot(s.setName('untrust').setDescription('Take a player off a plot (plot owner or admin)')), 'In-game name'))
    .addSubcommand((s) => addChoice(plot(s.setName('mode').setDescription('What happens to intruders')), 'mode', 'Mode', [{ name: 'send them out', value: 'eject' }, { name: 'warn only', value: 'warn' }, { name: 'off', value: 'off' }]))
    .addSubcommand((s) => plot(s.setName('exit').setDescription('Where intruders are sent'))
      .addStringOption((o) => o.setName('area').setDescription('Named spot, like RespawnPoint').setRequired(false).setAutocomplete(true))
      .addStringOption((o) => o.setName('location').setDescription('Or a location from /location').setRequired(false).setAutocomplete(true)))
    .addSubcommand((s) => addPlayer(plot(s.setName('spawn').setDescription('Set where the plot tree drops people (plot owner or admin)')), { required: false, description: 'Player standing on the spot, default you' }))
    .addSubcommand((s) => addPlayer(plot(s.setName('teleport').setDescription("Send a player to a plot's arrival spot")), { description: 'Who to send' }))
    .addSubcommand((s) => plot(s.setName('prefer').setDescription('Pick which of your plots the plot tree sends you to')))
    .addSubcommand((s) => addPlayer(s.setName('where').setDescription('Which chunk and plot a player is in')))
    .addSubcommand((s) => addPlayer(s.setName('why').setDescription('Why a player is or is not allowed where they stand')))
    .addSubcommand((s) => addName(addChoice(s.setName('tree').setDescription('Walk into a chunk, get sent to your plot (default 17-34)'), 'action', 'What to do', [{ name: 'set the chunk', value: 'set' }, { name: 'turn it off', value: 'off' }, { name: 'show it', value: 'show' }]), 'chunk', 'Chunk like 17-34 (default 17-34)', { required: false, max: 12 }))
    .addSubcommand((s) => addBool(s.setName('enforce').setDescription('Turn plot protection on or off for the whole server'), 'on', 'On or off'))
    .addSubcommand((s) => addBool(s.setName('leave').setDescription('Send owners and trusted players to the exit when they walk out of a plot'), 'on', 'On or off'))
    .addSubcommand((s) => addBool(s.setName('adminpass').setDescription('Let linked Discord admins into every plot'), 'on', 'On or off'))
    .addSubcommand((s) => nameOpt(s.setName('staff').setDescription('Players allowed in every plot, like admins'), 'In-game name')
      .addBooleanOption((o) => o.setName('allowed').setDescription('Add (true) or remove (false)').setRequired(true))),
  access: { list: 'everyone', map: 'everyone', info: 'everyone', trust: 'everyone', untrust: 'everyone', spawn: 'everyone', prefer: 'everyone', '*': 'admin' },

  async autocomplete(ctx, focused) {
    if (!ctx.server) return [];
    const q = String(focused.value).toLowerCase();
    if (focused.name === 'plot') return Object.keys(ctx.bot.plots.doc(ctx.server)).filter((k) => k.includes(q));
    if (focused.name === 'name') {
      if (ctx.sub === 'untrust') {
        const p = own(ctx.bot.plots.doc(ctx.server), String(ctx.opt('plot')).toLowerCase());
        return p ? p.trusted.filter((t) => t.toLowerCase().includes(q)) : [];
      }
      const online = targets.choices(ctx.bot, ctx.server, focused.value);
      if (ctx.sub === 'staff') return ctx.bot.plots.settings(ctx.server).staff.filter((n) => n.toLowerCase().includes(q)).concat(online);
      return online;
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
    if (ctx.sub === 'map') {
      return ctx.info('Plot map', plots.map(s) || 'No plots yet.');
    }
    if (ctx.sub === 'deleteall') {
      const count = Object.keys(plots.doc(s)).length;
      if (count === 0) return ctx.info('Nothing to delete', 'There are no plots.');
      if (!(await ctx.confirm('Delete every plot?', `${count} plot(s) are removed and everyone can walk in. This cannot be undone.`, { label: 'Delete all' }))) return null;
      const d = plots.doc(s);
      for (const k of Object.keys(d)) delete d[k];
      plots.save(s);
      ctx.note(`${count} plots`);
      return ctx.ok('Plots deleted', `${count} plot(s) removed.`);
    }
    if (ctx.sub === 'enforce') {
      plots.settings(s).enforce = ctx.opt('on');
      plots.saveSettings(s);
      return ctx.ok('Plot protection', ctx.opt('on') ? 'On.' : 'Off. Plots are kept but nobody is warned or sent out.');
    }
    if (ctx.sub === 'leave') {
      plots.settings(s).leave = ctx.opt('on');
      plots.saveSettings(s);
      return ctx.ok('Leaving a plot', ctx.opt('on') ? 'Owners and trusted players are sent to the exit when they walk out of a plot.' : 'Off. Players walk out of plots freely.');
    }
    if (ctx.sub === 'adminpass') {
      plots.settings(s).adminPass = ctx.opt('on');
      plots.saveSettings(s);
      return ctx.ok('Admin pass', ctx.opt('on') ? 'Members with Administrator who used /link can enter every plot.' : 'Off. Only owners, trusted players and /plot staff can enter.');
    }
    if (ctx.sub === 'staff') {
      const name = ctx.name('name');
      if (!isSafeName(name)) throw new UserError('That is not a valid in-game name.');
      const st = plots.settings(s);
      st.staff = st.staff.filter((x) => x.toLowerCase() !== name.toLowerCase());
      if (ctx.opt('allowed')) st.staff.push(name);
      plots.saveSettings(s);
      const known = s.roster.has(name.toLowerCase());
      const note = ctx.opt('allowed') && !known ? `\n\nNobody called "${name}" is online right now. The name has to match the in-game name exactly, so check the spelling.` : '';
      return ctx.ok('Plot staff', `Allowed in every plot: ${st.staff.join(', ') || 'nobody'}${note}`);
    }
    if (ctx.sub === 'where') {
      ctx.needOnline();
      const name = ctx.player();
      const { chunk } = await s.position(name);
      const p = plots.at(s, chunk);
      return ctx.info(name, `Chunk **${chunk}**${p ? `, inside the plot **${p.name}** (${p.owner})` : ', not in a plot'}.`);
    }
    if (ctx.sub === 'why') {
      ctx.needOnline();
      const name = ctx.player();
      return ctx.info(`Plots and ${name}`, await plots.why(s, name));
    }
    if (ctx.sub === 'tree') {
      const st = plots.settings(s);
      const action = ctx.opt('action');
      if (action === 'show') return ctx.info('Plot tree', treeText(st.tree));
      if (action === 'off') {
        st.tree = null;
        plots.saveSettings(s);
        ctx.note('off');
        return ctx.ok('Plot tree', 'Off. Turn it back on with `/plot tree action:set`.');
      }
      const c = overworldChunk(ctx.opt('chunk') || plots.defaultTree);
      if (!c) throw new UserError('That is not a chunk. Use a name like 17-34.');
      st.tree = { chunk: c };
      plots.saveSettings(s);
      ctx.note(treeText(st.tree));
      return ctx.ok('Plot tree set', `${treeText(st.tree)}\n\nAnyone with a plot who walks into that chunk is sent to their plot. Everyone else is left alone.`);
    }
    if (ctx.sub === 'create') {
      ctx.needOnline();
      const owner = ctx.player();
      const { chunk, pos } = await s.position(owner);
      if (!chunk) throw new UserError(`Could not read the chunk ${owner} is in.`);
      const p = plots.create(s, ctx.opt('name'), owner, chunk, pos);
      ctx.note(`${p.name} for ${owner} at ${chunk}`);
      return ctx.ok('Plot created', `${info(p)}\n\nGrow it with \`/plot grow\` while someone stands in the next chunk.`);
    }
    if (ctx.sub === 'claim') {
      const owner = ctx.name('owner');
      if (!isSafeName(owner)) throw new UserError('That is not a valid in-game name.');
      const online = s.roster.get(owner.toLowerCase());
      const p = plots.claim(s, ctx.opt('name'), online ? online.username : owner, ctx.opt('chunks'));
      ctx.note(`${p.name} for ${p.owner} at ${p.chunks.join(',')}`);
      return ctx.ok('Plot claimed', info(p));
    }
    const p = plots.get(s, ctx.opt('plot'));
    if (ctx.sub === 'info') return ctx.info(`Plot ${p.name}`, info(p));
    if (ctx.sub === 'prefer') {
      const me = ctx.self();
      if (!plots.allowed(s, p, me)) throw new UserError(`You are not on the plot ${p.name}.`);
      plots.settings(s).prefer[me.toLowerCase()] = p.name;
      plots.saveSettings(s);
      return ctx.ok('Plot tree', `The plot tree now sends you to ${p.name}.`);
    }
    if (ctx.sub === 'spawn') {
      if (!plots.canManage(ctx, p)) throw new UserError(`Only ${p.owner} (linked with /link) or an admin can move the arrival spot of ${p.name}.`);
      ctx.needOnline();
      const who = ctx.opt('player') ? ctx.player() : ctx.self();
      const { pos, chunk } = await s.position(who);
      if (!pos) throw new UserError(`Could not read where ${who} is.`);
      const inside = p.chunks.includes(overworldChunk(chunk));
      p.spawn = pos;
      plots.save(s);
      ctx.note(`${p.name} ${vecText(pos)}`);
      return ctx[inside ? 'ok' : 'warn']('Arrival spot set', `${p.name}: ${vecText(pos)}.${inside ? '' : `\nThat spot is outside the plot, in chunk ${chunk}.`}`);
    }
    if (ctx.sub === 'teleport') {
      ctx.needOnline();
      const who = ctx.player();
      if (!p.spawn) throw new UserError(`${p.name} has no arrival spot yet. Use /plot spawn.`);
      await s.teleportToPoint(who, p.spawn);
      ctx.note(`${who} to ${p.name}`);
      return ctx.ok('Teleported', `${who} went to ${p.name}.`);
    }
    if (ctx.sub === 'trust' || ctx.sub === 'untrust') {
      if (!plots.canManage(ctx, p)) throw new UserError(`Only ${p.owner} (linked with /link) or an admin can change who is trusted on ${p.name}.`);
      const name = ctx.name('name');
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
