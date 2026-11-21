const { Context } = require('./context');
const { UserError, isSafeName } = require('../game/text');

function plain(text, names = {}) {
  return String(text == null ? '' : text)
    .replace(/<t:(\d+)(?::[a-zA-Z])?>/g, (m, n) => `${new Date(Number(n) * 1000).toISOString().slice(0, 16).replace('T', ' ')} UTC`)
    .replace(/<@!?(\d+)>/g, (m, id) => (names[id] ? `@${names[id]}` : 'someone on Discord'))
    .replace(/<@&\d+>/g, 'a Discord role')
    .replace(/<#\d+>/g, 'a Discord channel')
    .replace(/\*\*|__|`/g, '')
    .replace(/\r/g, '')
    .trim();
}

function textOf(payload, names = {}) {
  if (typeof payload === 'string') return { title: '', text: plain(payload, names) };
  const e = payload && payload.embeds && payload.embeds[0];
  const d = e ? e.data || e : {};
  const fields = (d.fields || []).map((f) => `${plain(f.name, names)}: ${plain(f.value, names)}`);
  const body = plain(d.description || (payload && payload.content) || '', names);
  return { title: plain(d.title || '', names), text: [body, ...fields].filter(Boolean).join('\n') };
}

class TabletContext extends Context {
  constructor(bot, server, actor, command, sub, values, confirmer, who = {}) {
    const options = {
      get: (name) => (values[name] == null ? null : { name, value: values[name] }),
      getSubcommand: () => sub,
      getSubcommandGroup: () => null,
    };
    const interaction = {
      id: `tablet-${Date.now()}`,
      guildId: server.guildId,
      user: { id: who.discordId || `game:${actor}`, tag: `${actor} (in game)` },
      member: who.member || null,
      guild: who.guild || null,
      gameLevel: who.level || null,
      options,
      deferred: false,
      replied: false,
    };
    super(bot, interaction, command);
    this.server = server;
    this.actor = actor;
    this.gameRoles = who.roles || null;
    this.confirmer = confirmer || (async () => false);
    this.out = null;
    this.kind = null;
  }

  self() {
    if (!isSafeName(this.actor)) throw new UserError('Your name cannot be sent to the console.');
    return this.actor;
  }

  requireLink() {}

  async names(payload) {
    const ids = [...new Set([...JSON.stringify(payload || '').matchAll(/<@!?(\d+)>/g)].map((m) => m[1]))].slice(0, 10);
    const out = {};
    const client = this.bot.client;
    if (!client || !client.users) return out;
    for (const id of ids) {
      try {
        const u = client.users.cache.get(id) || await client.users.fetch(id);
        if (u) out[id] = u.globalName || u.username;
      } catch (e) {
        out[id] = null;
      }
    }
    return out;
  }

  async reply(payload) {
    this.out = textOf(payload, await this.names(payload));
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
