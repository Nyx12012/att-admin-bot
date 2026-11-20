const { Context } = require('./context');
const { UserError, isSafeName } = require('../game/text');

function plain(text) {
  return String(text == null ? '' : text)
    .replace(/<t:(\d+)(?::[a-zA-Z])?>/g, (m, n) => `${new Date(Number(n) * 1000).toISOString().slice(0, 16).replace('T', ' ')} UTC`)
    .replace(/<@[!&]?\d+>/g, 'someone on Discord')
    .replace(/<#\d+>/g, 'a Discord channel')
    .replace(/\*\*|__|`/g, '')
    .replace(/\r/g, '')
    .trim();
}

function textOf(payload) {
  if (typeof payload === 'string') return { title: '', text: plain(payload) };
  const e = payload && payload.embeds && payload.embeds[0];
  const d = e ? e.data || e : {};
  const fields = (d.fields || []).map((f) => `${plain(f.name)}: ${plain(f.value)}`);
  const body = plain(d.description || (payload && payload.content) || '');
  return { title: plain(d.title || ''), text: [body, ...fields].filter(Boolean).join('\n') };
}

class TabletContext extends Context {
  constructor(bot, server, actor, command, sub, values, confirmer) {
    const options = {
      get: (name) => (values[name] == null ? null : { name, value: values[name] }),
      getSubcommand: () => sub,
      getSubcommandGroup: () => null,
    };
    const interaction = {
      id: `tablet-${Date.now()}`,
      guildId: server.guildId,
      user: { id: `game:${actor}`, tag: `${actor} (in game)` },
      member: null,
      options,
      deferred: false,
      replied: false,
    };
    super(bot, interaction, command);
    this.server = server;
    this.actor = actor;
    this.confirmer = confirmer || (async () => false);
    this.out = null;
    this.kind = null;
  }

  self() {
    if (!isSafeName(this.actor)) throw new UserError('Your name cannot be sent to the console.');
    return this.actor;
  }

  requireLink() {}

  async reply(payload) {
    this.out = textOf(payload);
    return {
      awaitMessageComponent: async () => {
        throw new UserError('That needs Discord. Use the slash command there.');
      },
    };
  }

  ok(title, description, fields) {
    this.kind = 'ok';
    return super.ok(title, description, fields);
  }

  info(title, description, fields) {
    this.kind = 'info';
    return super.info(title, description, fields);
  }

  warn(title, description, fields) {
    this.kind = 'warn';
    return super.warn(title, description, fields);
  }

  fail(title, description, fields) {
    this.kind = 'fail';
    return super.fail(title, description, fields);
  }

  async confirm(title, description) {
    const yes = await this.confirmer(plain(title), plain(description));
    if (!yes) this.cancelled = true;
    return yes;
  }
}

module.exports = { TabletContext, plain, textOf };
