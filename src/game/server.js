const fs = require('fs');
const { EventEmitter } = require('events');
const { TavernClient } = require('tavern-client');
const { quoteName, quoteText, vec, vecText, chunkName, isSafeName, UserError } = require('./text');

const EVENTS = [
  'PlayerJoined', 'PlayerLeft', 'PlayerKilled', 'PlayerStateChanged', 'PlayerMovedChunk',
  'ObjectKilled', 'ServerSettingsChanged', 'SocialTabletPlayerReported', 'SocialTabletPlayerBanned',
  'AtmBalanceChanged', 'TradeDeckUsed', 'PopulationModified', 'TrialStarted', 'TrialFinished',
];

const AREAS = [
  'RespawnPoint', 'OriginalSpawnPoint', 'Home', 'OutsideTower', 'TowerCP1', 'TowerCP2', 'TowerCP3', 'TowerCP4',
  'TowerCP5', 'TowerEnd', 'OutsideCave', 'OutsideForest', 'OutsideLake', 'OutsideRockArena', 'MountainPass',
  'MountainPassEnd', 'BattleField', 'Glades', 'WoodcuttingShrine', 'ArcheryShrine', 'MeleeShrine', 'HolidayZone',
];

class OfflineError extends UserError {
  constructor(name) {
    super(`${name} is not connected to the game console right now.`);
  }
}

class GameServer extends EventEmitter {
  constructor(config, options = {}) {
    super();
    this.id = config.id;
    this.name = config.name;
    this.guildId = config.guildId;
    this.config = config;
    this.roster = new Map();
    this.readyAt = null;
    this.lastError = null;
    this.homeLocks = new Map();
    this.wantedBy = new Map();
    this.selectChain = Promise.resolve();
    this.log = options.log || ((level, msg) => console[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'](`[${this.id}] ${msg}`));
    this.tavern = options.client || new TavernClient({
      host: config.host,
      port: config.port,
      token: () => this.token(),
      log: (level, msg) => this.log(level, msg),
    });
    this.tavern.on('ready', () => this.onReady());
    this.tavern.on('close', (why) => {
      this.readyAt = null;
      this.lastError = why;
      this.emit('down', why);
    });
    this.tavern.on('rejected', (why) => {
      this.lastError = `the console refused the token (${why})`;
      this.log('error', `${this.lastError}. Check the console token in .env or servers.json.`);
    });
    this.tavern.on('event', (ev) => this.onEvent(ev));
    this.rosterTimer = null;
  }

  token() {
    if (this.config.token) return this.config.token;
    if (!this.config.tokenFile || !fs.existsSync(this.config.tokenFile)) {
      throw new Error(`console token file not found: ${this.config.tokenFile || '(not set)'}`);
    }
    return fs.readFileSync(this.config.tokenFile, 'utf8').trim();
  }

  async start() {
    for (const e of EVENTS) this.tavern.subscribe(e).catch(() => {});
    this.rosterTimer = setInterval(() => this.refreshRoster().catch(() => {}), 60000);
    this.rosterTimer.unref?.();
    const attempt = async () => {
      try {
        await this.tavern.connect();
      } catch (e) {
        this.lastError = e.message;
        this.log('warn', `cannot reach the console yet (${e.message}). Retrying in 15 s.`);
        this.retry = setTimeout(attempt, 15000);
        this.retry.unref?.();
      }
    };
    await attempt();
  }

  stop() {
    clearInterval(this.rosterTimer);
    clearTimeout(this.retry);
    this.tavern.close();
  }

  get online() {
    return this.tavern.connected && this.readyAt != null;
  }

  async onReady() {
    this.readyAt = Date.now();
    this.lastError = null;
    this.log('info', 'connected to the game console');
    await this.refreshRoster().catch(() => {});
    await this.probeBotCore();
    this.emit('ready');
  }

  async probeBotCore() {
    const r = await this.run('botcore version', { allowError: true, timeout: 10000 }).catch(() => null);
    const text = r && !r.error ? String(r.resultString || r.result || '') : '';
    const was = this.botcore;
    this.botcore = /^BotCore \d/.test(text) ? text : null;
    if (this.botcore && this.botcore !== was) this.log('info', `${this.botcore} found, ATM and mail commands are on`);
    return this.botcore;
  }

  async lookup(name) {
    if (!this.botcore) await this.probeBotCore();
    if (!this.botcore) throw new UserError('This needs the BotCore server mod. See the README, section "BotCore".');
    const text = String(await this.value(`botcore user ${quoteName(name)}`));
    const m = text.match(/^(online|offline) (\d+) (.+)$/);
    if (!m) throw new UserError(`${name} has never joined this server, so the game cannot find them.`);
    if (!isSafeName(m[3])) throw new UserError(`The stored name of ${name} cannot be sent to the console.`);
    return { state: m[1], id: Number(m[2]), username: m[3] };
  }

  onEvent(ev) {
    try {
      const data = ev && ev.data && typeof ev.data === 'object' ? ev.data : {};
      const user = data.user && typeof data.user.username === 'string' ? data.user : null;
      if (ev.type === 'PlayerJoined' && user) {
        this.roster.set(user.username.toLowerCase(), { id: user.id ?? null, username: user.username, since: Date.now() });
        this.rosterAt = Date.now();
      }
      if (ev.type === 'PlayerLeft' && user) this.roster.delete(user.username.toLowerCase());
      this.emit('event', ev.type, data, ev);
      this.emit(ev.type, data, ev);
    } catch (e) {
      this.log('warn', `an event handler failed on ${ev && ev.type}: ${e.message}`);
    }
  }

  async run(command, { timeout = 30000, allowError = false } = {}) {
    if (!this.tavern.connected) throw new OfflineError(this.name);
    const r = await this.tavern.command(command, timeout);
    if (r.error && !allowError) throw new GameError(command, r.error);
    return r;
  }

  async value(command, options) {
    const r = await this.run(command, options);
    if (r.result != null && !(typeof r.result === 'string' && r.result.trim() === '')) return r.result;
    return r.resultString;
  }

  async refreshRoster() {
    const list = await this.value('player list');
    const next = new Map();
    for (const p of Array.isArray(list) ? list : []) {
      const username = p.username ?? p.Username;
      if (!username) continue;
      const old = this.roster.get(String(username).toLowerCase());
      next.set(String(username).toLowerCase(), { id: p.id ?? p.Identifier ?? null, username: String(username), since: old ? old.since : Date.now() });
    }
    const before = this.roster;
    this.roster = next;
    this.rosterAt = Date.now();
    for (const [k, p] of next) if (!before.has(k)) this.emit('rosterJoin', p);
    for (const [k, p] of before) if (!next.has(k)) this.emit('rosterLeave', p);
    return [...next.values()];
  }

  players() {
    return [...this.roster.values()].sort((a, b) => a.username.localeCompare(b.username));
  }

  find(name) {
    if (!name) return null;
    const exact = this.roster.get(String(name).toLowerCase());
    if (exact) return exact;
    const lower = String(name).toLowerCase();
    const hits = this.players().filter((p) => p.username.toLowerCase().startsWith(lower));
    return hits.length === 1 ? hits[0] : null;
  }

  requireOnline(name) {
    const p = this.find(name);
    if (!p) throw new UserError(`${name} is not online.`);
    if (!isSafeName(p.username)) throw new UserError(`"${String(p.username).slice(0, 40)}" is not a valid player name.`);
    return p;
  }

  async detailed(name) {
    return this.value(`player detailed ${quoteName(name)}`);
  }

  async position(name) {
    const d = await this.detailed(name);
    return { pos: vec(d && d.Position), chunk: chunkName(d && d.Chunk), raw: d };
  }

  async message(target, text, seconds = 8) {
    const who = target === '*' ? '*' : quoteName(target);
    return this.run(`player message ${who} ${quoteText(text)} ${Math.max(1, Math.min(60, Math.round(seconds)))}`);
  }

  async broadcast(text, seconds = 8) {
    if (this.roster.size === 0) return null;
    return this.message('*', text, seconds);
  }

  async teleportToPlayer(name, target) {
    return this.run(`player teleport ${quoteName(name)} ${quoteName(target)}`);
  }

  async teleportToArea(name, area) {
    const hit = AREAS.find((a) => a.toLowerCase() === String(area).toLowerCase());
    if (!hit) throw new UserError(`Unknown destination "${area}".`);
    return this.run(`player teleport ${quoteName(name)} ${hit}`);
  }

  async teleportToPoint(name, point) {
    const p = vec(point);
    if (!p) throw new UserError('That location has no valid coordinates.');
    const key = name.toLowerCase();
    if (this.homeLocks.get(key)) throw new UserError(`A teleport for ${name} is already running.`);
    this.homeLocks.set(key, true);
    let restored = false;
    try {
      const home = vec(await this.value(`player get-home ${quoteName(name)}`)) || [0, 0, 0];
      await this.run(`player set-home ${quoteName(name)} ${vecText(p)}`);
      try {
        await this.run(`player teleport ${quoteName(name)} Home`);
      } finally {
        try {
          await this.run(`player set-home ${quoteName(name)} ${vecText(home)}`);
          restored = true;
        } catch (e) {
          this.log('warn', `could not put back the home point of ${name}: ${e.message}`);
        }
      }
    } finally {
      this.homeLocks.delete(key);
    }
    return restored;
  }

  async inventory(name) {
    const r = await this.value(`player inventory ${quoteName(name)}`);
    const inv = Array.isArray(r) ? r[0] : r;
    return inv && typeof inv === 'object' ? inv : null;
  }

  want(type, owner, on) {
    let owners = this.wantedBy.get(type);
    if (!owners) {
      owners = new Set();
      this.wantedBy.set(type, owners);
    }
    const before = owners.size > 0;
    if (on) owners.add(owner);
    else owners.delete(owner);
    const after = owners.size > 0;
    if (after && !before) this.tavern.subscribe(type).catch(() => {});
    if (!after && before && this.tavern.unsubscribe) this.tavern.unsubscribe(type).catch(() => {});
  }

  selected(fn) {
    const run = this.selectChain.then(fn, fn);
    this.selectChain = run.catch(() => {});
    return run;
  }

  async pick(id) {
    const n = Number(id);
    const sel = await this.run(`select ${n}`, { allowError: true });
    if (sel.error) return false;
    const m = String(sel.resultString ?? '').match(/^Selected:\s*(\d+)/);
    return Boolean(m) && Number(m[1]) === n;
  }

  destroyEntity(id) {
    return this.selected(async () => {
      if (!(await this.pick(id))) return false;
      const r = await this.run('select destroy', { allowError: true });
      return !r.error;
    });
  }

  entityString(id) {
    return this.selected(async () => {
      if (!(await this.pick(id))) return null;
      const v = await this.value('select tostring').catch(() => null);
      return typeof v === 'string' ? v : null;
    });
  }

  async heal(name, food = false) {
    const reset = { health: 'Max', poison: 'Min', nightmare: 'Min', cripplehealth: 'Max', hunger: 'Max' };
    const stats = await this.stats(name);
    const done = [];
    for (const st of stats) {
      const key = String(st.Name).toLowerCase();
      if (!reset[key] || (key === 'hunger' && !food)) continue;
      const value = reset[key] === 'Max' ? st.Max : st.Min;
      if (Number(st.Value) === Number(value)) continue;
      await this.setStat(name, st.Name, value);
      done.push(`${st.Name} ${Number(st.Value).toFixed(2)} to ${value}`);
    }
    return done;
  }

  async stats(name) {
    const list = await this.value(`player list-stats ${quoteName(name)}`);
    return Array.isArray(list) ? list : [];
  }

  async stat(name, stat) {
    const list = await this.stats(name);
    const hit = list.find((x) => String(x.Name).toLowerCase() === String(stat).toLowerCase());
    if (!hit) throw new UserError(`${name} has no stat called "${stat}". Try /player stats.`);
    const r = await this.value(`player check-stat ${quoteName(name)} ${hit.Name}`).catch(() => null);
    const base = r && r.Base != null ? Number(r.Base) : Number(hit.Value);
    return { name: hit.Name, min: Number(hit.Min), max: Number(hit.Max), value: Number(hit.Value), base };
  }

  async setStat(name, stat, value) {
    if (!/^[A-Za-z-]{2,40}$/.test(stat)) throw new UserError(`"${stat}" is not a stat name.`);
    return this.run(`player set-stat ${quoteName(name)} ${stat} ${Number(value)}`);
  }

  async settings(timeout = 30000) {
    const s = await this.value('settings list server', { timeout });
    return s && typeof s === 'object' ? s : {};
  }

  async changeSetting(name, value) {
    if (!/^[A-Za-z]{2,60}$/.test(name)) throw new UserError(`"${name}" is not a setting name.`);
    const v = String(value);
    if (!/^[A-Za-z0-9.\-]{1,30}$/.test(v)) throw new UserError(`"${v}" is not a valid value.`);
    return this.run(`settings changesetting server ${name} ${v}`);
  }

  status() {
    return {
      online: this.online,
      players: this.roster.size,
      since: this.readyAt,
      error: this.lastError,
    };
  }
}

class GameError extends UserError {
  constructor(command, error) {
    super(`The server refused \`${command.split(' ').slice(0, 3).join(' ')}\`: ${String(error).replace(/\s+/g, ' ').slice(0, 300)}`);
    this.command = command;
    this.gameError = error;
  }
}

module.exports = { GameServer, OfflineError, GameError, AREAS, EVENTS, isSafeName };
