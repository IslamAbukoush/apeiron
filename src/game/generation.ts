/** Serializable generation output. Rendering and future model adapters share this contract. */
export type Theme = 'candy' | 'forest' | 'desert' | 'frozen' | 'volcanic' | 'cosmic';
export type PropKind = 'lollipop' | 'gumdrop' | 'candyTree' | 'tree' | 'mushroom' | 'rock' | 'cactus' | 'crystal';
export type WorldProp = { id: string; kind: PropKind; x: number; z: number; scale: number; rotation: number; color: string };
export type WorldDefinition = {
  version: 1;
  prompt: string;
  seed: string;
  theme: Theme;
  name: string;
  summary: string;
  fallback: boolean;
  night: boolean;
  palette: { sky: string; ground: string; path: string; accent: string; secondary: string; trunk: string };
  props: WorldProp[];
};

const themes: Record<Theme, { name: string; words: string[]; palette: WorldDefinition['palette']; kinds: PropKind[]; scenery: string }> = {
  candy: {
    name: 'Sugarbloom Valley', words: ['candy', 'candies', 'candyes', 'sweet', 'sweets', 'sugary', 'sugar', 'chocolate', 'lollipop', 'marshmallow', 'gingerbread', 'cupcake'],
    palette: { sky: '#f9cbe6', ground: '#ec9ac7', path: '#fff0d5', accent: '#ee5097', secondary: '#89e6d4', trunk: '#fff4df' },
    kinds: ['lollipop', 'gumdrop', 'candyTree'], scenery: 'lollipop groves, gumdrops and a giant cupcake',
  },
  forest: {
    name: 'Whisperwood', words: ['forest', 'woodland', 'woods', 'jungle', 'enchanted', 'fairy', 'mushroom', 'nature', 'trees'],
    palette: { sky: '#b5d7cd', ground: '#527452', path: '#baa381', accent: '#577f70', secondary: '#b48acc', trunk: '#6c4b39' },
    kinds: ['tree', 'tree', 'mushroom', 'rock'], scenery: 'branching groves, giant mushrooms and an ancient tree',
  },
  desert: {
    name: 'Amber Expanse', words: ['desert', 'sand', 'sandy', 'dune', 'dunes', 'arid', 'cactus', 'cacti', 'egypt'],
    palette: { sky: '#f5cea2', ground: '#dca66b', path: '#f6d39b', accent: '#488477', secondary: '#bd7754', trunk: '#906149' },
    kinds: ['cactus', 'rock'], scenery: 'cactus groves, sandstone rocks and a stepped pyramid',
  },
  frozen: {
    name: 'Frostglass Reach', words: ['ice', 'icy', 'snow', 'snowy', 'winter', 'frozen', 'arctic', 'glacier', 'frost'],
    palette: { sky: '#c2d9f3', ground: '#e1edf6', path: '#adccdf', accent: '#7fb8e5', secondary: '#b6a0ed', trunk: '#7192af' },
    kinds: ['crystal', 'rock'], scenery: 'ice crystals, snowy boulders and a towering frost spire',
  },
  volcanic: {
    name: 'Emberfall Basin', words: ['lava', 'volcano', 'volcanic', 'fire', 'fiery', 'inferno', 'ash', 'hell'],
    palette: { sky: '#6b404b', ground: '#3d363e', path: '#89675b', accent: '#ff864b', secondary: '#d74e59', trunk: '#493f4c' },
    kinds: ['rock', 'crystal'], scenery: 'obsidian rocks, ember crystals and a glowing volcanic peak',
  },
  cosmic: {
    name: 'Starlit Garden', words: ['space', 'cosmic', 'alien', 'galaxy', 'galactic', 'moon', 'lunar', 'planet', 'crystal', 'crystals'],
    palette: { sky: '#272444', ground: '#5b4e80', path: '#aa92c4', accent: '#6ee8e2', secondary: '#ed99d7', trunk: '#63567d' },
    kinds: ['crystal', 'mushroom', 'rock'], scenery: 'alien mushrooms, crystal fields and a ringed monolith',
  },
};

function hash(text: string) {
  let value = 2166136261;
  for (const character of text) value = Math.imul(value ^ character.charCodeAt(0), 16777619);
  return value >>> 0;
}

function randomFrom(seed: string) {
  let state = hash(seed);
  return () => {
    state += 0x6d2b79f5;
    let value = Math.imul(state ^ state >>> 15, 1 | state);
    value ^= value + Math.imul(value ^ value >>> 7, 61 | value);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

/** Local keyword planner: bounded, deterministic and independent of Three.js or network services. */
export function generateWorld(description: string, seed = '1'): WorldDefinition {
  const prompt = description.trim();
  if (!prompt) throw new Error('Describe your world before generating it.');
  if (prompt.length > 600) throw new Error('Keep your world description within 600 characters.');
  seed = seed.trim() || '1';
  if (seed.length > 64) throw new Error('Keep the seed within 64 characters.');
  const words = prompt.toLowerCase().match(/[a-z]+/g) ?? [];
  const tokens = new Set(words);
  let theme: Theme = 'forest';
  let best = 0;
  for (const [candidate, settings] of Object.entries(themes)) {
    const score = settings.words.reduce((sum, word) => sum + Number(tokens.has(word)), 0);
    if (score > best) { best = score; theme = candidate as Theme; }
  }
  const settings = themes[theme];
  const palette = { ...settings.palette };
  // Explicit color wishes override the ground and the primary decorations.
  const colors: Record<string, string> = { pink: '#ec9ac7', purple: '#a78bca', blue: '#86bce5', green: '#6d9a72', red: '#ca646e', orange: '#df9a62', yellow: '#e8ce80' };
  for (const word of words) {
    if (colors[word]) { palette.ground = colors[word]; palette.accent = colors[word]; break; }
  }
  const night = ['night', 'nighttime', 'dark', 'midnight'].some(word => tokens.has(word)) || theme === 'cosmic';
  if (night) palette.sky = '#22243f';
  const sparse = ['sparse', 'empty', 'barren'].some(word => tokens.has(word));
  const dense = ['dense', 'lush', 'overgrown'].some(word => tokens.has(word));
  const count = sparse ? 24 : dense ? 72 : 48;
  const random = randomFrom(`${prompt.toLowerCase()}|${seed}`);
  const props: WorldProp[] = [];
  // A jittered grid guarantees spacing; the crossing paths and spawn are always clear.
  const cells: { x: number; z: number }[] = [];
  for (let x = -24; x <= 24; x += 4) {
    for (let z = -24; z <= 24; z += 4) {
      if (Math.abs(x) < 5 || Math.abs(z) < 5) continue;
      cells.push({ x, z });
    }
  }
  for (let i = cells.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [cells[i], cells[j]] = [cells[j], cells[i]];
  }
  for (const cell of cells.slice(0, count)) {
    props.push({
      id: `prop-${props.length}`, kind: settings.kinds[Math.floor(random() * settings.kinds.length)],
      x: cell.x + (random() - 0.5) * 0.8, z: cell.z + (random() - 0.5) * 0.8,
      scale: 0.75 + random() * 0.5, rotation: random() * Math.PI * 2,
      color: random() > 0.5 ? palette.accent : palette.secondary,
    });
  }
  return {
    version: 1, prompt, seed, theme, name: settings.name, palette, night, props, fallback: best === 0,
    summary: `${night ? 'A moonlit' : 'A'} ${theme} world with ${settings.scenery}. ${sparse ? 'Sparse' : dense ? 'Lush' : 'Scattered'} scenery surrounds open walking paths.`,
  };
}
