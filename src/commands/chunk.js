const { SlashCommandBuilder } = require('discord.js');
const { addPlayer, addInt, addBool } = require('../core/opts');
const { overworldChunk, chunkBounds, UserError } = require('../game/text');

function target(ctx) {
  if (!ctx.opt('player')) return ctx.self();
  if (!ctx.bot.permissions.allows(ctx.i, 'chunk.admin', 'admin')) throw new UserError('Only admins can pick another player. Leave the player empty to use yourself.');
  return ctx.player();
}

function maybePlayer(s) {
  return addPlayer(s, { required: false, description: 'Admins can pick a player, default you' });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('chunk')
    .setDescription('See where the chunks and plot borders are, right in the game')
    .addSubcommand((s) => addInt(maybePlayer(s.setName('show').setDescription('Mark the border of your chunk for a few minutes')), 'minutes', 'How long, default 5', { required: false, min: 1, max: 30 }))
    .addSubcommand((s) => addBool(maybePlayer(s.setName('hide').setDescription('Remove the markers now')), 'all', 'Every marked chunk (admins)', { required: false }))
    .addSubcommand((s) => maybePlayer(addBool(s.setName('watch').setDescription('Show the chunk and plot name on screen when you cross a border'), 'on', 'On or off')))
    .addSubcommand((s) => maybePlayer(s.setName('where').setDescription('Your chunk and how far each border is'))),
  access: 'everyone',

  async run(ctx) {
    const s = ctx.needOnline();
    const markers = ctx.bot.markers;
    if (ctx.sub === 'hide') {
      if (ctx.opt('all')) {
        if (!ctx.bot.permissions.allows(ctx.i, 'chunk.admin', 'admin')) throw new UserError('Only admins can clear every marked chunk.');
        const r = await markers.hide(s, { all: true });
        return ctx.ok('Markers', r.left ? `Removed what is loaded. ${r.left} chunk(s) go when someone is next nearby.` : 'All markers are gone.');
      }
      const name = target(ctx);
      const r = await markers.hide(s, { name });
      if (r.asked === 0) return ctx.info('Markers', 'You have no markers, and none are in your chunk.');
      return ctx.ok('Markers', r.left ? 'Removed what is loaded. The rest goes when someone is next nearby.' : 'Gone.');
    }
    const name = target(ctx);
    if (ctx.sub === 'watch') {
      const key = `${s.id}:${name.toLowerCase()}`;
      if (ctx.opt('on')) markers.watching.add(key);
      else markers.watching.delete(key);
      return ctx.ok('Chunk watch', ctx.opt('on') ? `${name} sees the chunk and plot name on every border until the bot restarts.` : 'Off.');
    }
    if (ctx.sub === 'where') {
      const { pos, chunk: raw } = await s.position(name);
      const chunk = overworldChunk(raw);
      if (!pos || !chunk) return ctx.info(name, 'Indoors, in a cave or somewhere plots do not apply.');
      const b = chunkBounds(chunk);
      const plot = ctx.bot.plots.at(s, chunk);
      return ctx.info(name, `Chunk **${chunk}**${plot ? `, ${plot.owner}'s plot **${plot.name}**` : ', no plot'}.\nBorders: ${Math.round(pos[0] - b.minX)} m to the low x side, ${Math.round(b.maxX - pos[0])} m to the high x side, ${Math.round(pos[2] - b.minZ)} m to the low z side, ${Math.round(b.maxZ - pos[2])} m to the high z side.`);
    }
    const minutes = ctx.opt('minutes') || 5;
    const set = await markers.show(s, name, { minutes, by: name });
    ctx.note(`${set.chunk} for ${minutes} min`);
    return ctx.ok('Chunk marked', `Chunk **${set.chunk}**: graves with a beam of light at the corners, lamp posts along the sides. They clear in ${minutes} minutes, or use \`/chunk hide\`.`);
  },
};
