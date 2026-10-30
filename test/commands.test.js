const test = require('node:test');
const assert = require('node:assert');
const { loadCommands } = require('../src/core/registry');

const commands = loadCommands();

test('every command builds for Discord', () => {
  assert.ok(commands.size > 0 && commands.size <= 100);
  for (const [name, c] of commands) {
    const j = c.data.toJSON();
    assert.strictEqual(j.name, name);
    assert.ok(j.description.length <= 100, `/${name} description is too long`);
    assert.ok(typeof c.run === 'function', `/${name} has no run`);
  }
});

test('required options come before optional ones', () => {
  for (const [name, c] of commands) {
    const j = c.data.toJSON();
    const leaves = (j.options || []).some((o) => o.type === 1 || o.type === 2)
      ? (j.options || []).flatMap((o) => (o.type === 2 ? o.options : [o])).map((s) => [s.name, s.options || []])
      : [['', j.options || []]];
    assert.ok(leaves.length <= 25, `/${name} has more than 25 subcommands`);
    for (const [sub, opts] of leaves) {
      let optional = false;
      for (const o of opts) {
        if (!o.required) optional = true;
        else assert.ok(!optional, `/${name} ${sub}: ${o.name} is required after an optional option`);
        assert.ok(o.description.length <= 100, `/${name} ${sub} ${o.name}: description too long`);
      }
    }
  }
});

test('access levels are known words', () => {
  for (const [name, c] of commands) {
    const levels = typeof c.access === 'object' ? Object.values(c.access) : [c.access || 'admin'];
    for (const l of levels) assert.ok(['everyone', 'admin', 'owner'].includes(l), `/${name} has access "${l}"`);
  }
});
