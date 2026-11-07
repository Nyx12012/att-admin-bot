const { SlashCommandBuilder, ChannelType } = require('discord.js');
const { addName, addText, addInt } = require('../core/opts');
const { embed } = require('../core/ui');
const { UserError } = require('../game/text');

function where(b) {
  return b.addChannelOption((o) => o.setName('channel').setDescription('Where to post, default here').setRequired(false).addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement));
}

function target(ctx) {
  const ch = ctx.channel('channel');
  return ch ? ch.id : ctx.i.channelId;
}

async function send(ctx, payload) {
  const msg = await ctx.bot.post(target(ctx), payload);
  if (!msg) throw new UserError('The bot could not post there. Check its channel permissions.');
  return ctx.ok('Posted', `In <#${target(ctx)}>.`);
}

const say = {
  data: where(addText(new SlashCommandBuilder().setName('say').setDescription('Post a message as the bot'), 'text', 'What to say', { max: 2000 })),
  access: 'admin',

  async run(ctx) {
    ctx.note(String(ctx.opt('text')).slice(0, 200));
    return send(ctx, { content: ctx.opt('text'), allowedMentions: { parse: [] } });
  },
};

const post = {
  data: where(addText(addName(new SlashCommandBuilder().setName('embed').setDescription('Post a neat box as the bot'), 'title', 'Title', { max: 200 }), 'text', 'Body', { max: 2000 })),
  access: 'admin',

  async run(ctx) {
    ctx.note(String(ctx.opt('title')).slice(0, 200));
    return send(ctx, { embeds: [embed('info', ctx.opt('title'), ctx.opt('text'))] });
  },
};

const poll = {
  data: where(addInt(addText(addName(new SlashCommandBuilder().setName('poll').setDescription('Post a poll'), 'question', 'The question', { max: 280 }), 'answers', 'Answers split by commas, up to 10', { max: 500 }), 'hours', 'How long it runs (default 24)', { required: false, min: 1, max: 336 })),
  access: 'admin',

  async run(ctx) {
    const answers = String(ctx.opt('answers')).split(',').map((a) => a.trim()).filter(Boolean);
    if (answers.length < 2 || answers.length > 10) throw new UserError('A poll needs 2 to 10 answers.');
    if (answers.some((a) => a.length > 55)) throw new UserError('Each answer can have at most 55 characters.');
    ctx.note(String(ctx.opt('question')).slice(0, 200));
    return send(ctx, { poll: { question: { text: ctx.opt('question') }, answers: answers.map((text) => ({ text })), duration: ctx.opt('hours') || 24, allowMultiselect: false } });
  },
};

module.exports = [say, post, poll];
