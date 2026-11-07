const { SlashCommandBuilder } = require('discord.js');
const { addPlayer, addInt, addBool } = require('../core/opts');
const { UserError, isSafeName } = require('../game/text');

const SPRIGGULL = 62050;

const smiting = new Set();

async function smite(server, name) {
  if (smiting.has(server.id)) throw new UserError('A smite is already running, wait a moment.');
  smiting.add(server.id);
  const failed = [];
  try {
    const before = await server.settings();
    try {
      await server.changeSetting('DownedStateDuration', '0');
      await server.changeSetting('DropAllOnDeath', 'true');
      await server.run(`player kill "${name}"`);
      await new Promise((r) => setTimeout(r, 2500));
    } finally {
      const restore = [['DownedStateDuration', String(before.DownedStateDuration ?? 60)], ['DropAllOnDeath', String(Boolean(before.DropAllOnDeath))]];
      for (const [key, value] of restore) {
        await server.changeSetting(key, value).catch((e) => {
          failed.push(`${key} ${value}`);
          console.warn(`[${server.id}] smite could not put back ${key}=${value}: ${e.message}`);
        });
      }
    }
  } finally {
    smiting.delete(server.id);
  }
  return failed;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('fun')
    .setDescription('Silly and handy tricks')
    .addSubcommand((s) => addPlayer(s.setName('smite').setDescription('Kill a player on the spot and drop everything they carry')))
    .addSubcommand((s) => addInt(addPlayer(s.setName('fling').setDescription('Launch a player into the air')), 'height', 'Meters up (default 25)', { required: false, min: 5, max: 200 }))
    .addSubcommand((s) => addBool(addPlayer(s.setName('featherweight').setDescription('Carry anything without weight')), 'on', 'On or off'))
    .addSubcommand((s) => addBool(addPlayer(s.setName('nohunger').setDescription('Never get hungry')), 'on', 'On or off'))
    .addSubcommand((s) => addPlayer(s.setName('clarity').setDescription('Remove nightmare')))
    .addSubcommand((s) => addPlayer(s.setName('chicken').setDescription('Drop a live spriggull in front of a player')))
    .addSubcommand((s) => addInt(addPlayer(s.setName('hearts').setDescription('Set how many hearts a player has')), 'hearts', 'Hearts, 8 is normal', { min: 1, max: 96 }))
    .addSubcommand((s) => addPlayer(s.setName('meeting').setDescription('Bring everyone online to one player'), { description: 'Everyone goes to this player' }))
    .addSubcommand((s) => addPlayer(addPlayer(s.setName('surprise').setDescription('Drop a player from the sky onto another'), { description: 'Who falls' }), { name: 'target', description: 'Who they land on' }))
    .addSubcommand((s) => addPlayer(s.setName('void').setDescription('Send a player under the world')))
    .addSubcommand((s) => s.setName('forgeall').setDescription('Finish every unforged blade on the map')),
  access: 'admin',

  async run(ctx) {
    const s = ctx.needOnline();
    if (ctx.sub === 'forgeall') {
      await s.run('progress forgeall', { timeout: 120000 });
      return ctx.ok('Forged', 'Every unforged blade on the map is finished.');
    }
    const name = ctx.player();
    ctx.note(name);
    if (ctx.sub === 'meeting') {
      const others = s.players().map((p) => p.username).filter((n) => n !== name && isSafeName(n));
      for (const other of others) await s.teleportToPlayer(other, name);
      return ctx.ok('Meeting', `${others.length} player(s) went to ${name}.`);
    }
    switch (ctx.sub) {
      case 'smite': {
        const failed = await smite(s, name);
        if (failed.length) return ctx.warn('Smitten, but check the settings', `${name} died, but these settings could not be put back: ${failed.join(', ')}. Fix them with /settings set.`);
        return ctx.ok('Smitten', `${name} died on the spot and dropped everything.`);
      }
      case 'fling': {
        const { pos } = await s.position(name);
        if (!pos) throw new UserError(`Could not read where ${name} is.`);
        const height = ctx.opt('height') || 25;
        const restored = await s.teleportToPoint(name, [pos[0], pos[1] + height, pos[2]]);
        if (!restored) return ctx.warn('Flung, but check their home', `${name} was flung ${height} m up, but their respawn point could not be put back. Fix it with /home reset.`);
        return ctx.ok('Wheee', `${name} was flung ${height} m up.`);
      }
      case 'featherweight':
        await s.run(`player set-stat "${name}" playerweight ${ctx.opt('on') ? 0 : 99999} Max`);
        return ctx.ok('Featherweight', `${name}: ${ctx.opt('on') ? 'on' : 'off'}.`);
      case 'nohunger':
        await s.run(`player set-stat "${name}" hunger ${ctx.opt('on') ? 2 : 0} Min`);
        return ctx.ok('No hunger', `${name}: ${ctx.opt('on') ? 'never hungry until a restart or until you turn it off' : 'normal hunger again'}.`);
      case 'chicken':
        await s.run(`spawn "${name}" ${SPRIGGULL}`);
        return ctx.ok('Bawk', `A spriggull appeared in front of ${name}.`);
      case 'hearts':
        await s.setStat(name, 'maxhealth', ctx.opt('hearts') / 4);
        await s.setStat(name, 'health', ctx.opt('hearts') / 4);
        return ctx.ok('Hearts', `${name} now has ${ctx.opt('hearts')} hearts.`);
      case 'surprise': {
        const target = ctx.player('target');
        const { pos } = await s.position(target);
        if (!pos) throw new UserError(`Could not read where ${target} is.`);
        await s.teleportToPoint(name, [pos[0], pos[1] + 30, pos[2]]);
        return ctx.ok('Surprise', `${name} is falling onto ${target}.`);
      }
      case 'void': {
        const { pos } = await s.position(name);
        if (!pos) throw new UserError(`Could not read where ${name} is.`);
        await s.teleportToPoint(name, [pos[0], -100, pos[2]]);
        return ctx.ok('Into the void', `${name} went under the world.`);
      }
      default:
        await s.setStat(name, 'nightmare', 0);
        return ctx.ok('Clarity', `${name} has no nightmare now.`);
    }
  },
};
