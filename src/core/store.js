const fs = require('fs');
const path = require('path');

class Store {
  constructor(dir) {
    this.dir = dir;
    this.cache = new Map();
    this.timers = new Map();
    fs.mkdirSync(dir, { recursive: true });
  }

  file(name) {
    return path.join(this.dir, `${name}.json`);
  }

  get(name, fallback) {
    if (this.cache.has(name)) return this.cache.get(name);
    let value;
    const f = this.file(name);
    if (fs.existsSync(f)) {
      try {
        value = JSON.parse(fs.readFileSync(f, 'utf8'));
      } catch (e) {
        const broken = `${f}.broken-${Date.now()}`;
        fs.copyFileSync(f, broken);
        console.error(`[store] ${f} could not be read (${e.message}). A copy was kept as ${broken}.`);
      }
    }
    if (value === undefined) value = typeof fallback === 'function' ? fallback() : structuredClone(fallback ?? {});
    this.cache.set(name, value);
    return value;
  }

  save(name) {
    if (this.timers.has(name)) return;
    this.timers.set(name, setTimeout(() => {
      this.timers.delete(name);
      this.write(name);
    }, 250));
  }

  write(name, attempt = 0) {
    if (!this.cache.has(name)) return;
    const f = this.file(name);
    try {
      fs.mkdirSync(path.dirname(f), { recursive: true });
      const tmp = `${f}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.cache.get(name), null, 2));
      fs.renameSync(tmp, f);
    } catch (e) {
      if (attempt < 5) {
        const t = setTimeout(() => this.write(name, attempt + 1), 1000 * (attempt + 1));
        t.unref?.();
      } else {
        console.error(`[store] could not save ${f}: ${e.message}. Is the folder read only, or held by OneDrive or an antivirus?`);
      }
    }
  }

  update(name, fallback, fn) {
    const value = this.get(name, fallback);
    const result = fn(value);
    this.save(name);
    return result;
  }

  flush() {
    for (const [name, timer] of this.timers) {
      clearTimeout(timer);
      this.write(name);
    }
    this.timers.clear();
  }
}

module.exports = { Store };
