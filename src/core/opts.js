function player(o, { required = true, name = 'player', description = 'An online player' } = {}) {
  return o.setName(name).setDescription(description).setRequired(required).setAutocomplete(true);
}

function addPlayer(b, options) {
  return b.addStringOption((o) => player(o, options));
}

function addItem(b, { required = true, name = 'item', description = 'Item name or prefab hash' } = {}) {
  return b.addStringOption((o) => o.setName(name).setDescription(description).setRequired(required).setAutocomplete(true));
}

function addMaterial(b, { required = false } = {}) {
  return b.addStringOption((o) => o.setName('material').setDescription('Wood, metal or other material, like Redwood or Iron').setRequired(required).setAutocomplete(true));
}

function addName(b, name, description, { required = true, auto = false, max = 32 } = {}) {
  return b.addStringOption((o) => o.setName(name).setDescription(description).setRequired(required).setAutocomplete(auto).setMaxLength(max));
}

function addText(b, name, description, { required = true, max = 180 } = {}) {
  return b.addStringOption((o) => o.setName(name).setDescription(description).setRequired(required).setMaxLength(max));
}

function addInt(b, name, description, { required = true, min, max } = {}) {
  return b.addIntegerOption((o) => {
    o.setName(name).setDescription(description).setRequired(required);
    if (min != null) o.setMinValue(min);
    if (max != null) o.setMaxValue(max);
    return o;
  });
}

function addNumber(b, name, description, { required = true, min, max } = {}) {
  return b.addNumberOption((o) => {
    o.setName(name).setDescription(description).setRequired(required);
    if (min != null) o.setMinValue(min);
    if (max != null) o.setMaxValue(max);
    return o;
  });
}

function addChoice(b, name, description, choices, { required = true } = {}) {
  return b.addStringOption((o) => o.setName(name).setDescription(description).setRequired(required)
    .addChoices(...choices.map((c) => (typeof c === 'string' ? { name: c, value: c } : c))));
}

function addBool(b, name, description, { required = true } = {}) {
  return b.addBooleanOption((o) => o.setName(name).setDescription(description).setRequired(required));
}

module.exports = { addPlayer, addItem, addMaterial, addName, addText, addInt, addNumber, addChoice, addBool };
