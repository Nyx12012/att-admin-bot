const { plain } = require('../core/tabletctx');

const WIDTH = 44;

function enc(s) {
  return encodeURIComponent(String(s));
}

function parse(go) {
  const s = String(go || '');
  const qi = s.indexOf('?');
  const head = qi < 0 ? s : s.slice(0, qi);
  const parts = head.split('/').filter(Boolean).map((p) => {
    try {
      return decodeURIComponent(p);
    } catch {
      return p;
    }
  });
  const q = Object.create(null);
  if (qi >= 0) {
    for (const [k, v] of new URLSearchParams(s.slice(qi + 1))) if (!(k in q)) q[k] = v.slice(0, 80);
  }
  return { area: String(parts[0] || 'home').toLowerCase(), path: parts.slice(1), q };
}

function link(area, path = [], q = {}) {
  const head = [area, ...path].map(enc).join('/');
  const qs = Object.keys(q).filter((k) => q[k] != null && q[k] !== '').map((k) => `${enc(k)}=${enc(q[k])}`).join('&');
  return qs ? `${head}?${qs}` : head;
}

function row(k, t, d, extra = {}) {
  return { k, t, d: d || '', ...extra };
}

function wrap(text, width = WIDTH) {
  const out = [];
  for (const para of plain(text).split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      if (!line) line = word;
      else if (line.length + 1 + word.length <= width) line += ` ${word}`;
      else {
        out.push(line);
        line = word;
      }
      while (line.length > width) {
        out.push(line.slice(0, width));
        line = line.slice(width);
      }
    }
    if (line) out.push(line);
  }
  return out;
}

function lines(text, warn = false) {
  return wrap(text).map((t) => ({ k: '', t, m: 'x', ...(warn ? { w: 1 } : {}) }));
}

function page(title, rows, { status = '', r = null, text = '' } = {}) {
  return { title, rows, status, r, text };
}

module.exports = { parse, link, row, wrap, lines, page };
