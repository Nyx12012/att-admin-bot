const { EmbedBuilder } = require('discord.js');

const COLORS = {
  info: 0x4f7cac,
  ok: 0x3f9e6b,
  warn: 0xd4a017,
  fail: 0xc0392b,
  muted: 0x5c6370,
};

function fit(text, max) {
  const s = String(text ?? '');
  if (s.length <= max) return s;
  const note = '\n(more not shown)';
  const cut = s.slice(0, max - note.length);
  const nl = cut.lastIndexOf('\n');
  return `${nl > max / 2 ? cut.slice(0, nl) : cut}${note}`;
}

function embed(kind, title, description, fields) {
  const e = new EmbedBuilder().setColor(COLORS[kind] ?? COLORS.info);
  if (title) e.setTitle(String(title).slice(0, 256));
  if (description) e.setDescription(fit(description, 4000));
  if (fields && fields.length) {
    e.addFields(fields.slice(0, 25).map((f) => ({
      name: String(f.name ?? f[0]).slice(0, 256) || '​',
      value: fit(f.value ?? f[1] ?? '', 1024) || '​',
      inline: Boolean(f.inline ?? f[2]),
    })));
  }
  return e;
}

function code(text) {
  return `\`${String(text).replace(/`/g, "'")}\``;
}

function list(items, empty = 'None') {
  if (!items || items.length === 0) return empty;
  const out = [];
  let size = 0;
  for (const item of items) {
    const line = String(item);
    if (size + line.length + 1 > 3900) {
      out.push(`and ${items.length - out.length} more`);
      break;
    }
    out.push(line);
    size += line.length + 1;
  }
  return out.join('\n');
}

function ago(ms) {
  if (ms == null) return 'never';
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`;
}

function minutes(n) {
  if (n < 60) return `${n} min`;
  const h = Math.floor(n / 60);
  const m = n % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

function stamp(ms) {
  return `<t:${Math.floor(ms / 1000)}:R>`;
}

module.exports = { COLORS, embed, code, list, ago, minutes, stamp };
