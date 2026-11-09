const { UserError } = require('../game/text');

const LIST = [
  ['oak', 'Oak Wood'],
  ['birch', 'Birch Wood'],
  ['walnut', 'Walnut Wood'],
  ['ash', 'Ash Wood'],
  ['redwood', 'Redwood'],
  ['darksteelalloy', 'Darksteel Alloy'],
  ['aluminium', 'Aluminium'],
  ['brass', 'Brass'],
  ['carsialloy', 'Palladium'],
  ['copper', 'Copper'],
  ['evinonsteelalloy', 'Valyan'],
  ['gold', 'Gold'],
  ['iron', 'Iron'],
  ['mythril', 'Mythril'],
  ['orchialloy', 'Viridium'],
  ['redironalloy', 'Red Iron'],
  ['silver', 'Silver'],
  ['tin', 'Tin'],
  ['trainingmetalcold', 'Trainingmetal Cold'],
  ['trainingmetalhot', 'Trainingmetal Hot'],
  ['whitegoldalloy', 'Electrum'],
  ['daisleather', 'Leather'],
  ['daisredleather', 'Reddish Leather'],
  ['unknownleather', 'Grey Leather'],
  ['wyrmfaceleather', 'Green Leather'],
  ['canvas', 'Canvas'],
  ['rope', 'Rope'],
  ['straw', 'Straw'],
  ['redwoodgoteracorematerial', 'Grass'],
];

function squash(text) {
  return String(text ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

const ALL = LIST.map(([value, name]) => ({ value, name, key: squash(name) }));

function find(text) {
  const key = squash(text);
  if (!key) return null;
  return ALL.find((m) => m.value === key || m.key === key) || null;
}

function fromOption(text) {
  if (text == null || String(text).trim() === '') return null;
  const hit = find(text);
  if (!hit) throw new UserError(`"${String(text).slice(0, 40)}" is not a material. Pick one from the list.`);
  return hit;
}

function label(raw) {
  const hit = find(raw);
  return hit ? hit.name : String(raw);
}

function search(query) {
  const key = squash(query);
  return ALL.filter((m) => m.value.includes(key) || m.key.includes(key)).slice(0, 25).map(({ name, value }) => ({ name, value }));
}

function named(itemName, material) {
  return material ? `${itemName} (${material.name})` : itemName;
}

module.exports = { squash, find, fromOption, label, search, named };
