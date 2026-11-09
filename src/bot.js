const { Client, GatewayIntentBits, Events, ActivityType, REST, Routes } = require('discord.js');
const { Store } = require('./core/store');
const { Permissions } = require('./core/permissions');
const { Audit } = require('./core/audit');
const { Registry } = require('./core/registry');
const { GameServer } = require('./game/server');

const FEATURES = ['links', 'bans', 'logs', 'playerlist', 'cleanup', 'plots', 'announce', 'reports', 'economy', 'alchemy', 'stats', 'autobuff', 'markers', 'power'];

const STATS = [
  'health', 'maxhealth', 'speed', 'damage', 'poison', 'hunger', 'fullness', 'damageprotection', 'luminosity',
  'cripplehealth', 'crippledamageprotection', 'xpboost', 'nightmare', 'playerweight', 'aggro', 'Frost',
];

class Bot {
  constructor(config, options = {}) {
    this.config = config;
    this.store = options.store || new Store(config.dataDir);
    this.permissions = new Permissions(this.store, config.ownerIds);
    this.audit = new Audit(config.dataDir, this);
    this.servers = new Map();
    this.byGuild = new Map();
    for (const s of config.servers) {
      const server = options.makeServer ? options.makeServer(s) : new GameServer(s);
      this.servers.set(s.id, server);
      if (s.guildId) this.byGuild.set(s.guildId, server);
    }
    this.client = options.client || new Client({ intents: [GatewayIntentBits.Guilds] });
    this.registry = new Registry(this, options.commands);
    this.features = {};
    for (const name of FEATURES) {
      const Feature = require(`./features/${name}`);
      this.features[name] = new Feature(this);
      this[name] = this.features[name];
    }
    this.settingCache = new Map();
  }

  serverFor(guildId) {
    return this.byGuild.get(guildId) || null;
  }

  guildDoc(guildId) {
    return this.store.get(`guild-${guildId}`, () => ({}));
  }

  guildSetting(guildId, key) {
    const d = this.guildDoc(guildId);
    if (!d[key]) d[key] = {};
    return d[key];
  }

  setGuild(guildId, key, field, value) {
    this.store.update(`guild-${guildId}`, {}, (d) => {
      d[key] = d[key] || {};
      if (value == null) delete d[key][field];
      else d[key][field] = value;
    });
  }

  channelFor(server, kind) {
    if (!server || !server.guildId) return null;
    return this.guildSetting(server.guildId, 'channels')[kind] || null;
  }

  async post(channelId, payload) {
    if (!channelId || !this.client.isReady()) return null;
    try {
      const ch = await this.client.channels.fetch(channelId);
      if (!ch || !ch.isTextBased()) return null;
      return await ch.send(payload);
    } catch (e) {
      if (!this.postErrors) this.postErrors = new Set();
      if (!this.postErrors.has(channelId)) {
        this.postErrors.add(channelId);
        console.warn(`[discord] cannot post in channel ${channelId}: ${e.message}`);
      }
      return null;
    }
  }

  statNames() {
    return STATS;
  }

  settingNames(server) {
    const cached = server && this.settingCache.get(server.id);
    return cached ? Object.keys(cached) : [];
  }

  async loadSettings(server, timeout) {
    const s = await server.settings(timeout);
    this.settingCache.set(server.id, s);
    return s;
  }

  async register() {
    const rest = new REST({ version: '10' }).setToken(this.config.discordToken);
    const appId = this.client.application ? this.client.application.id : (await rest.get(Routes.currentApplication())).id;
    const body = this.registry.json();
    for (const server of this.servers.values()) {
      if (!server.guildId) {
        console.warn(`[discord] server "${server.id}" has no Discord server id, so it gets no commands.`);
        continue;
      }
      try {
        await rest.put(Routes.applicationGuildCommands(appId, server.guildId), { body });
        console.log(`[discord] ${body.length} commands ready in Discord server ${server.guildId} for "${server.name}".`);
      } catch (e) {
        console.error(`[discord] could not add commands to Discord server ${server.guildId}: ${e.message}. Is the bot in that server, invited with "applications.commands"? See SETUP.md step 2.`);
      }
    }
  }

  updatePresence() {
    if (!this.client.isReady()) return;
    const parts = [...this.servers.values()].map((s) => (s.online ? `${s.roster.size} online` : 'offline'));
    this.client.user.setActivity(parts.join(' | ') || 'idle', { type: ActivityType.Watching });
  }

  async start() {
    this.client.on(Events.InteractionCreate, (i) => this.registry.handle(i).catch((e) => console.error('[discord]', e)));
    this.client.once(Events.ClientReady, async () => {
      console.log(`[discord] logged in as ${this.client.user.tag}`);
      try {
        await this.register();
      } catch (e) {
        console.error(`[discord] could not register slash commands: ${e.message}`);
      }
      for (const f of Object.values(this.features)) if (f.discordReady) f.discordReady();
      this.updatePresence();
    });
    for (const f of Object.values(this.features)) if (f.start) f.start();
    for (const server of this.servers.values()) {
      server.on('ready', () => this.updatePresence());
      server.on('down', () => this.updatePresence());
      server.on('rosterJoin', () => this.updatePresence());
      server.on('rosterLeave', () => this.updatePresence());
      server.start().catch((e) => console.error(`[${server.id}]`, e));
    }
    await this.client.login(this.config.discordToken);
  }

  async stop() {
    for (const f of Object.values(this.features)) if (f.stop) f.stop();
    for (const s of this.servers.values()) s.stop();
    this.store.flush();
    await this.client.destroy();
  }
}

module.exports = { Bot };
