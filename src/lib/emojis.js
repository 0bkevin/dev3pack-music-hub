// Curated searchable emoji catalog (Spanish + English keywords) + custom single-emoji detector

export const EMOJI_CATALOG = [
  // Music & Vibes
  ['🎧', 'musica auriculares headphones dj audio'],
  ['🎵', 'musica nota music note song'],
  ['🎶', 'musica notas melodia notes melody'],
  ['🎤', 'microfono cantar karaoke mic sing'],
  ['🎸', 'guitarra rock music'],
  ['🎹', 'piano teclado synth'],
  ['🥁', 'bateria tambor drums beat'],
  ['🎷', 'saxofon jazz sax'],
  ['🎺', 'trompeta salsa trumpet'],
  ['🎻', 'violin clasica'],
  ['🪩', 'disco fiesta bola party mirrorball'],
  ['📻', 'radio retro'],
  ['🔊', 'volumen sonido speaker'],
  // Energy & Tech
  ['🔥', 'fuego fire lit hot'],
  ['⚡', 'rayo energia zap lightning bolt'],
  ['🚀', 'cohete espacio rocket launch'],
  ['💻', 'laptop codigo dev code computer'],
  ['👾', 'alien juego hacker pixel invader'],
  ['🤖', 'robot bot ai tech'],
  ['🛸', 'ovni ufo alien'],
  ['✨', 'estrellas brillo sparkles magic'],
  ['🌟', 'estrella star'],
  ['💫', 'estrella fugaz dizzy'],
  ['💥', 'explosion boom'],
  ['💎', 'diamante gem diamond'],
  ['👑', 'corona rey reina crown king queen'],
  ['🏆', 'trofeo ganador trophy win'],
  ['🎯', 'diana foco target'],
  // Faces & Expressions
  ['😎', 'lentes cool gafas sunglasses'],
  ['😄', 'feliz sonrisa smile happy'],
  ['😂', 'risa llorar laugh lol'],
  ['🥳', 'fiesta celebracion party'],
  ['🤩', 'estrella wow emocion'],
  ['😍', 'amor enamorado love heart'],
  ['🤯', 'mente explotada mindblown'],
  ['😈', 'diablo travieso devil'],
  ['👻', 'fantasma anonimo ghost'],
  ['💀', 'calavera skull dead'],
  ['👽', 'extraterrestre alien'],
  ['🤡', 'payaso clown'],
  ['🤠', 'vaquero cowboy'],
  ['🥸', 'disfraz incognito disguise'],
  ['🥷', 'ninja sigilo stealth'],
  ['🧙', 'mago wizard magic'],
  ['🧑‍🚀', 'astronauta espacio astronaut'],
  // Animals
  ['🦊', 'zorro fox'],
  ['🐱', 'gato cat'],
  ['🐶', 'perro dog'],
  ['🐼', 'panda oso bear'],
  ['🦁', 'leon lion'],
  ['🐯', 'tigre tiger'],
  ['🐸', 'rana frog pepe'],
  ['🐙', 'pulpo octopus'],
  ['🦄', 'unicornio unicorn'],
  ['🐉', 'dragon'],
  ['🦖', 'dinosaurio trex dino'],
  ['🦈', 'tiburon shark'],
  ['🦋', 'mariposa butterfly'],
  ['🐝', 'abeja bee'],
  ['🦉', 'buho noche owl'],
  ['🐧', 'pinguino linux penguin'],
  ['🐺', 'lobo wolf'],
  ['🐵', 'mono monkey'],
  ['🦅', 'aguila eagle'],
  ['🦩', 'flamenco flamingo'],
  // Nature & Cosmos
  ['🌊', 'ola mar agua wave ocean'],
  ['🌙', 'luna noche moon night'],
  ['☀️', 'sol dia sun'],
  ['🌈', 'arcoiris rainbow'],
  ['🌸', 'flor cerezo sakura flower'],
  ['🌹', 'rosa rose'],
  ['🌵', 'cactus desierto'],
  ['🌴', 'palmera playa caracas palm'],
  ['🍀', 'trebol suerte clover luck'],
  ['🪐', 'saturno planeta planet space'],
  ['🌋', 'volcan volcano'],
  // Food & Drinks
  ['🍕', 'pizza comida'],
  ['🌮', 'taco comida'],
  ['🍔', 'hamburguesa burger'],
  ['🍣', 'sushi'],
  ['🍜', 'ramen sopa'],
  ['☕', 'cafe coffee'],
  ['🧋', 'boba te tea'],
  ['🍺', 'cerveza birra beer'],
  ['🍷', 'vino vinotinto wine'],
  ['🍸', 'coctel cocktail'],
  ['🍓', 'fresa strawberry'],
  ['🥑', 'aguacate palta avocado'],
  ['🌶️', 'picante chile spicy'],
  ['🍩', 'dona donut'],
  // Hearts & Symbols
  ['💜', 'corazon morado purple heart'],
  ['❤️', 'corazon rojo red heart love'],
  ['🖤', 'corazon negro black heart'],
  ['🩷', 'corazon rosa pink heart'],
  ['🤍', 'corazon blanco white heart'],
  ['💯', 'cien perfecto 100'],
  ['✌️', 'paz victoria peace'],
  ['🤘', 'rock mano horns'],
  ['🤙', 'shaka vibra chill'],
  ['🙌', 'manos celebrar hands'],
  ['⚽', 'futbol soccer'],
  ['🏀', 'baloncesto basketball'],
  ['🎮', 'videojuegos gaming controller'],
  ['🛹', 'skate patineta'],
  ['🎨', 'arte diseño art paint'],
  ['📸', 'camara foto camera'],
  ['🧭', 'brujula explorar compass'],
];

export const DEFAULT_EMOJIS = EMOJI_CATALOG.slice(0, 16).map(([e]) => e);

const segmenter =
  typeof Intl !== 'undefined' && Intl.Segmenter
    ? new Intl.Segmenter('en', { granularity: 'grapheme' })
    : null;
const EMOJI_CHAR_RE = /\p{Extended_Pictographic}/u;
const DISALLOWED_EMOJI_CP = /[\u{E0000}-\u{E007F}\p{Mark}]/u;

export function extractSingleEmoji(input) {
  const s = (input || '').trim();
  if (!s || s.length > 14 || /[<>"'&`\\/\s\r\n\t]/.test(s)) return null;
  const segs = segmenter ? [...segmenter.segment(s)].map((x) => x.segment) : [...s];
  if (segs.length !== 1 || !EMOJI_CHAR_RE.test(segs[0])) return null;
  const stripped = segs[0].replace(/[\uFE0F\u200D]/g, '');
  if (DISALLOWED_EMOJI_CP.test(stripped) || /\p{Cf}/u.test(stripped)) return null;
  return segs[0];
}

export function searchEmojis(query) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return EMOJI_CATALOG.map(([e]) => e);
  const exactEmoji = extractSingleEmoji(query);
  const hits = EMOJI_CATALOG.filter(
    ([e, kw]) => e === q || kw.includes(q)
  ).map(([e]) => e);
  if (exactEmoji && !hits.includes(exactEmoji)) {
    return [exactEmoji, ...hits];
  }
  return hits;
}
