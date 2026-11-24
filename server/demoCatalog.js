// Built-in offline demo catalog (used only when Spotify credentials are not configured)

const DEMO_CATALOG = [
  { id: 'demo-1', name: 'Midnight City', artists: 'M83', album: "Hurry Up, We're Dreaming", durationMs: 243000, hue: 260 },
  { id: 'demo-2', name: 'Get Lucky', artists: 'Daft Punk, Pharrell Williams', album: 'Random Access Memories', durationMs: 248000, hue: 45 },
  { id: 'demo-3', name: 'Vivir Mi Vida', artists: 'Marc Anthony', album: '3.0', durationMs: 262000, hue: 12 },
  { id: 'demo-4', name: 'Tití Me Preguntó', artists: 'Bad Bunny', album: 'Un Verano Sin Ti', durationMs: 243000, hue: 160 },
  { id: 'demo-5', name: 'Starboy', artists: 'The Weeknd, Daft Punk', album: 'Starboy', durationMs: 230000, hue: 300 },
  { id: 'demo-6', name: 'Bohemian Rhapsody', artists: 'Queen', album: 'A Night at the Opera', durationMs: 354000, hue: 210 },
  { id: 'demo-7', name: 'Levitating', artists: 'Dua Lipa', album: 'Future Nostalgia', durationMs: 203000, hue: 190 },
  { id: 'demo-8', name: 'Provenza', artists: 'Karol G', album: 'Mañana Será Bonito', durationMs: 212000, hue: 140 },
  { id: 'demo-9', name: 'Take On Me', artists: 'a-ha', album: 'Hunting High and Low', durationMs: 225000, hue: 200 },
  { id: 'demo-10', name: 'Nights', artists: 'Frank Ocean', album: 'Blonde', durationMs: 307000, hue: 330 },
  { id: 'demo-11', name: 'Gasolina', artists: 'Daddy Yankee', album: 'Barrio Fino', durationMs: 192000, hue: 25 },
  { id: 'demo-12', name: 'Clair de Lune', artists: 'Flight Facilities', album: 'Down to Earth', durationMs: 272000, hue: 175 },
].map((t) => ({ ...t, uri: null, imageUrl: null, spotifyUrl: null, source: 'demo' }));

const GENRE_MATCHES = {
  electronic: ['demo-1', 'demo-2', 'demo-9', 'demo-12'],
  rock: ['demo-6'],
};

export function searchDemoCatalog(query) {
  const q = query.trim().toLowerCase();
  const genreIds = Object.hasOwn(GENRE_MATCHES, q) ? GENRE_MATCHES[q] : [];
  return DEMO_CATALOG.filter(
    (t) =>
      t.name.toLowerCase().includes(q) ||
      t.artists.toLowerCase().includes(q) ||
      t.album.toLowerCase().includes(q) ||
      genreIds.includes(t.id)
  );
}

export function getDemoTrackById(id) {
  if (typeof id !== 'string') return null;
  return DEMO_CATALOG.find((t) => t.id === id) || null;
}

export function randomDemoTrack(excludeIds = new Set()) {
  const pool = DEMO_CATALOG.filter((t) => !excludeIds.has(t.id));
  return pool[Math.floor(Math.random() * pool.length)] || null;
}
