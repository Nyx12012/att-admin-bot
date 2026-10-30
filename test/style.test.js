const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const acorn = require('acorn');

const root = path.resolve(__dirname, '..');
const SKIP = new Set(['node_modules', 'data', '.git', 'logs', 'bin']);
const DASHES = [String.fromCharCode(0x2013), String.fromCharCode(0x2014)];

function files(dir = root, out = []) {
  for (const name of fs.readdirSync(dir)) {
    if (SKIP.has(name) || name === '.env' || name === 'servers.json') continue;
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) files(full, out);
    else out.push(full);
  }
  return out;
}

const all = files().concat(fs.existsSync(path.join(root, 'data')) ? fs.readdirSync(path.join(root, 'data')).filter((f) => !f.endsWith('.json') || f === 'items.json').map((f) => path.join(root, 'data', f)) : []);

test('no em or en dashes anywhere', () => {
  for (const f of all) {
    const text = fs.readFileSync(f, 'utf8');
    for (const d of DASHES) assert.ok(!text.includes(d), `${path.relative(root, f)} has a long dash`);
  }
});

test('no comments in JavaScript', () => {
  for (const f of all.filter((x) => x.endsWith('.js'))) {
    const comments = [];
    acorn.parse(fs.readFileSync(f, 'utf8'), { ecmaVersion: 'latest', sourceType: 'script', allowHashBang: true, onComment: comments });
    assert.strictEqual(comments.length, 0, `${path.relative(root, f)} has a comment: ${comments[0] && comments[0].value.slice(0, 40)}`);
  }
});

test('no comments in scripts', () => {
  for (const f of all.filter((x) => x.endsWith('.bat') || x.endsWith('.cmd'))) {
    for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) assert.ok(!/^\s*(rem\b|::)/i.test(line), `${path.relative(root, f)} has a comment line`);
  }
  for (const f of all.filter((x) => x.endsWith('.sh'))) {
    fs.readFileSync(f, 'utf8').split(/\r?\n/).forEach((line, i) => assert.ok(i === 0 || !/^\s*#/.test(line), `${path.relative(root, f)} has a comment line`));
  }
  for (const f of all.filter((x) => x.endsWith('.ps1'))) {
    for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) assert.ok(!/^\s*#/.test(line) && !line.includes('<#'), `${path.relative(root, f)} has a comment`);
  }
});

test('no comments in C#', () => {
  for (const f of all.filter((x) => x.endsWith('.cs'))) {
    const code = fs.readFileSync(f, 'utf8').replace(/@"(?:[^"]|"")*"/g, '""').replace(/"(?:[^"\\\n]|\\.)*"/g, '""').replace(/'(?:[^'\\\n]|\\.)'/g, "''");
    assert.ok(!/\/\/|\/\*/.test(code), `${path.relative(root, f)} has a comment`);
  }
});

test('no secrets in example files', () => {
  for (const f of all.filter((x) => /\.example/.test(x))) {
    const text = fs.readFileSync(f, 'utf8');
    assert.ok(!/eyJ[A-Za-z0-9_-]{20,}/.test(text), `${path.relative(root, f)} holds a token`);
    assert.ok(!/[MN][A-Za-z0-9]{23}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27}/.test(text), `${path.relative(root, f)} holds a Discord token`);
  }
});
