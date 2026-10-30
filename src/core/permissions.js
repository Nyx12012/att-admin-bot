const { PermissionFlagsBits } = require('discord.js');

const LEVELS = { everyone: 0, admin: 1, owner: 2 };

class Permissions {
  constructor(store, ownerIds) {
    this.store = store;
    this.ownerIds = new Set(ownerIds);
  }

  doc(guildId) {
    return this.store.get(`guild-${guildId}`, () => ({}));
  }

  grants(guildId) {
    const d = this.doc(guildId);
    if (!d.grants) d.grants = {};
    return d.grants;
  }

  isOwner(member, guild, userId) {
    if (this.ownerIds.has(userId)) return true;
    return Boolean(guild && guild.ownerId === userId);
  }

  isAdmin(member, guild, userId) {
    if (this.isOwner(member, guild, userId)) return true;
    try {
      return Boolean(member && member.permissions && member.permissions.has(PermissionFlagsBits.Administrator));
    } catch {
      return false;
    }
  }

  granted(guildId, member, userId, key) {
    const g = this.grants(guildId)[key];
    if (!g) return false;
    if (g.users && g.users.includes(userId)) return true;
    const roles = member && member.roles && member.roles.cache ? [...member.roles.cache.keys()] : [];
    return Boolean(g.roles && g.roles.some((r) => roles.includes(r)));
  }

  allows(interaction, key, level, { baseCovers = true } = {}) {
    const { member, guild, user, guildId } = interaction;
    if (!guildId) return false;
    if (this.isOwner(member, guild, user.id)) return true;
    if (this.granted(guildId, member, user.id, key)) return true;
    const base = key.split('.')[0];
    if (base !== key && baseCovers && this.granted(guildId, member, user.id, base)) return true;
    if (LEVELS[level] === LEVELS.everyone) return true;
    if (LEVELS[level] === LEVELS.admin) return this.isAdmin(member, guild, user.id);
    return false;
  }

  grant(guildId, key, kind, id) {
    this.store.update(`guild-${guildId}`, {}, (d) => {
      d.grants = d.grants || {};
      const g = d.grants[key] = d.grants[key] || { roles: [], users: [] };
      const arr = g[kind];
      if (!arr.includes(id)) arr.push(id);
    });
  }

  revoke(guildId, key, kind, id) {
    return this.store.update(`guild-${guildId}`, {}, (d) => {
      const g = d.grants && d.grants[key];
      if (!g) return false;
      const before = g[kind].length;
      g[kind] = g[kind].filter((x) => x !== id);
      if (g.roles.length === 0 && g.users.length === 0) delete d.grants[key];
      return g[kind].length !== before;
    });
  }
}

module.exports = { Permissions, LEVELS };
