const { SlashCommandBuilder } = require('discord.js');
const { addPlayer, addNumber, addName } = require('../core/opts');
const { UserError, own } = require('../game/text');

function target(s) {
  return addPlayer(s, { name: 'target', description: 'Player to go to' });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('tp')
    .setDescription('Teleport players')
    .addSubcommand((s) => target(addPlayer(s.setName('player').setDescription('Send a player to another player'))))
    .addSubcommand((s) => addName(addPlayer(s.setName('area').setDescription('Send a player to a named spot like OutsideCave')), 'area', 'Destination', { auto: true, max: 40 }))
    .addSubcommand((s) => addName(addPlayer(s.setName('location').setDescription('Send a player to a saved location')), 'location', 'Saved with /location save', { auto: true }))
    .addSubcommand((s) => addNumber(addNumber(addNumber(addPlayer(s.setName('coords').setDescription('Send a player to x, y, z')), 'x', 'x'), 'y', 'y (height)'), 'z', 'z'))
    .addSubcommand((s) => addPlayer(s.setName('summon').setDescription('Bring a player to you (needs /link)')))
    .addSubcommand((s) => s.setName('summonall').setDescription('Bring everyone online to you (needs /link)'))
    .addSubcommand((s) => target(s.setName('goto').setDescription('Go to a player yourself (needs /link)'))),
  access: 'admin',

  async run(ctx) {
    const s = ctx.needOnline();
    if (ctx.sub === 'summonall') {
      const me = s.requireOnline(ctx.self()).username;
      const others = s.players().filter((p) => p.username !== me);
      for (const p of others) await s.teleportToPlayer(p.username, me).catch(() => {});
      ctx.note(`${others.length} to ${me}`);
      return ctx.ok('Summoned', `${others.length} player(s) brought to ${me}.`);
    }
    if (ctx.sub === 'goto') {
      const me = s.requireOnline(ctx.self()).username;
      const to = ctx.player('target');
      await s.teleportToPlayer(me, to);
      return ctx.ok('Teleported', `${me} went to ${to}.`);
    }
    if (ctx.sub === 'summon') {
      const me = s.requireOnline(ctx.self()).username;
      const name = ctx.player();
      await s.teleportToPlayer(name, me);
      ctx.note(`${name} to ${me}`);
      return ctx.ok('Summoned', `${name} was brought to ${me}.`);
    }
    const name = ctx.player();
    if (ctx.sub === 'player') {
      const to = ctx.player('target');
      if (to === name) throw new UserError('Pick two different players.');
      await s.teleportToPlayer(name, to);
      ctx.note(`${name} to ${to}`);
      return ctx.ok('Teleported', `${name} went to ${to}.`);
    }
    if (ctx.sub === 'area') {
      await s.teleportToArea(name, ctx.opt('area'));
      ctx.note(`${name} to ${ctx.opt('area')}`);
      return ctx.ok('Teleported', `${name} went to ${ctx.opt('area')}.`);
    }
    if (ctx.sub === 'location') {
      const key = String(ctx.opt('location')).toLowerCase();
      const loc = own(ctx.data('locations', {}), key);
      if (!loc) throw new UserError(`There is no saved location "${key}". See /location list.`);
      const restored = await s.teleportToPoint(name, loc.pos);
      ctx.note(`${name} to ${key}`);
      return restored ? ctx.ok('Teleported', `${name} went to ${key}.`) : ctx.warn('Teleported, but check their home', `${name} went to ${key}, but their respawn point could not be put back. Fix it with /home reset.`);
    }
    const pos = [ctx.opt('x'), ctx.opt('y'), ctx.opt('z')];
    const restored = await s.teleportToPoint(name, pos);
    ctx.note(`${name} to ${pos.join(',')}`);
    const where = pos.map((n) => n.toFixed(1)).join(', ');
    return restored ? ctx.ok('Teleported', `${name} went to ${where}.`) : ctx.warn('Teleported, but check their home', `${name} went to ${where}, but their respawn point could not be put back. Fix it with /home reset.`);
  },
};
