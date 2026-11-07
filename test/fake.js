const { EventEmitter } = require('events');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { GameServer } = require('../src/game/server');
const { Store } = require('../src/core/store');

class FakeTavern extends EventEmitter {
  constructor(handler) {
    super();
    this.handler = handler || (() => ({ resultString: 'Success', result: null }));
    this.sent = [];
    this.connected = false;
  }

  async connect() {
    this.connected = true;
    this.emit('ready');
  }

  async subscribe() {
    return 'Success';
  }

  async command(text) {
    this.sent.push(text);
    const r = await this.handler(text, this);
    if (r == null) return { resultString: 'Success', result: null };
    if (typeof r === 'string') return { resultString: r, result: null };
    return r;
  }

  close() {
    this.connected = false;
  }

  push(type, data) {
    this.emit('event', { type, data });
  }
}

class FakeOptions {
  constructor(data) {
    this.data = data;
  }

  flat() {
    const out = [];
    const walk = (list) => {
      for (const o of list) {
        if (o.options) walk(o.options);
        else out.push(o);
      }
    };
    walk(this.data);
    return out;
  }

  get(name) {
    return this.flat().find((o) => o.name === name) || null;
  }

  getSubcommand() {
    const find = (list) => {
      for (const o of list) {
        if (o.type === 1) return o.name;
        if (o.type === 2) return find(o.options);
      }
      return null;
    };
    return find(this.data);
  }

  getSubcommandGroup() {
    const g = this.data.find((o) => o.type === 2);
    return g ? g.name : null;
  }

  getFocused(full) {
    const f = this.flat().find((o) => o.focused);
    return full ? { name: f.name, value: f.value } : f.value;
  }
}

function options(sub, values = {}, group) {
  const leaf = Object.entries(values).map(([name, value]) => {
    if (value && typeof value === 'object' && value.focused) return { name, value: value.value, focused: true, type: 3 };
    if (value && typeof value === 'object' && (value.role || value.channel || value.user)) return { name, ...value, value: (value.role || value.channel || value.user).id, type: 3 };
    return { name, value, type: 3 };
  });
  if (!sub) return leaf;
  const s = { name: sub, type: 1, options: leaf };
  return group ? [{ name: group, type: 2, options: [s] }] : [s];
}

class FakeInteraction {
  constructor({ command, sub, group, values, userId = 'u1', admin = true, owner = false, guildId = 'g1', confirm = true, picks = [], roles = [], autocomplete = false }) {
    this.id = String(Math.random()).slice(2);
    this.commandName = command;
    this.guildId = guildId;
    this.user = { id: userId, tag: `user${userId}` };
    this.guild = { id: guildId, ownerId: owner ? userId : 'someone-else' };
    this.member = {
      permissions: { has: () => admin },
      roles: { cache: new Map(roles.map((r) => [r, {}])) },
    };
    this.options = new FakeOptions(options(sub, values, group));
    this.replies = [];
    this.deferred = false;
    this.replied = false;
    this.confirm = confirm;
    this.picks = [...picks];
    this.auto = autocomplete;
    this.responded = null;
    this.channel = null;
  }

  isAutocomplete() { return this.auto; }
  isChatInputCommand() { return !this.auto; }
  isButton() { return false; }
  isStringSelectMenu() { return false; }

  async deferReply() { this.deferred = true; }

  async reply(p) {
    this.replied = true;
    this.replies.push(p);
    return this.message();
  }

  async editReply(p) {
    this.replies.push(p);
    return this.message();
  }

  async followUp(p) {
    this.replies.push(p);
    return this.message();
  }

  async respond(choices) { this.responded = choices; }

  message() {
    const self = this;
    return {
      awaitMessageComponent: async ({ filter }) => {
        const value = self.picks && self.picks.length ? self.picks.shift() : null;
        const press = { user: self.user, customId: `confirm:${self.id}:${self.confirm ? 'yes' : 'no'}`, values: value == null ? [] : [value], deferUpdate: async () => {} };
        if (filter && !filter(press)) throw new Error('filtered');
        return press;
      },
    };
  }

  last() {
    const p = this.replies[this.replies.length - 1];
    if (!p) return null;
    const e = p.embeds && p.embeds[0];
    const j = e ? (e.toJSON ? e.toJSON() : e) : {};
    return { title: j.title || '', text: [j.title, j.description, ...(j.fields || []).map((f) => `${f.name}: ${f.value}`)].filter(Boolean).join('\n'), raw: p, color: j.color };
  }
}

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'att-bot-test-'));
}

function makeBot(handler, { players = ['Alice', 'Bob'], ownerIds = [] } = {}) {
  const { Bot } = require('../src/bot');
  const dir = tempDir();
  const tavern = new FakeTavern(handler);
  const sentPosts = [];
  const client = new EventEmitter();
  client.isReady = () => true;
  client.user = { tag: 'bot', setActivity() {} };
  client.channels = { fetch: async (id) => ({ id, isTextBased: () => true, send: async (p) => { sentPosts.push({ id, p }); return { id: `m${sentPosts.length}`, edit: async () => {} }; }, messages: { fetch: async () => { throw new Error('none'); } } }) };
  client.login = async () => {};
  client.destroy = async () => {};
  const config = { root: dir, dataDir: dir, discordToken: 'x', ownerIds, servers: [{ id: 'main', name: 'Test Server', guildId: 'g1', host: '127.0.0.1', port: 1760, token: 't' }] };
  const bot = new Bot(config, {
    store: new Store(dir),
    client,
    makeServer: (s) => new GameServer(s, { client: tavern, log: () => {} }),
  });
  const server = bot.servers.get('main');
  tavern.connected = true;
  server.readyAt = Date.now();
  for (const name of players) server.roster.set(name.toLowerCase(), { id: name.length, username: name, since: Date.now() });
  server.rosterAt = Date.now() + 3600000;
  return { bot, server, tavern, posts: sentPosts, dir };
}

async function run(bot, spec) {
  const i = new FakeInteraction(spec);
  await bot.registry.handle(i);
  return i;
}

module.exports = { FakeTavern, FakeInteraction, makeBot, run, tempDir };
