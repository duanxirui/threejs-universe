import { ALL_BODIES } from '../data/celestials.js';

const KEY = 'cosmos-atlas-v3-personal-v1';
const MAX_RECENTS = 12;
const validBodyIds = new Set(ALL_BODIES.map(body => body.id));

const validIds = list => Array.isArray(list)
  ? [...new Set(list.filter(id => typeof id === 'string' && validBodyIds.has(id)))]
  : [];

export function createLocalAtlas(onChange = () => {}) {
  let favorites = [];
  let recents = [];
  let available = true;
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
    favorites = validIds(saved.favorites);
    recents = validIds(saved.recents).slice(0, MAX_RECENTS);
  } catch {
    // Storage can be disabled or contain an older/malformed schema.
    available = false;
  }

  function snapshot() {
    return { favorites: [...favorites], recents: [...recents], available };
  }

  function persist() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ favorites, recents }));
      available = true;
    } catch {
      available = false; // Browsing still works in memory.
    }
    onChange(snapshot());
  }

  return {
    snapshot,
    isFavorite: id => favorites.includes(id),
    toggleFavorite(id) {
      if (!validBodyIds.has(id)) return false;
      favorites = favorites.includes(id) ? favorites.filter(item => item !== id) : [...favorites, id];
      persist();
      return favorites.includes(id);
    },
    recordVisit(id) {
      if (!validBodyIds.has(id) || recents[0] === id) return;
      recents = [id, ...recents.filter(item => item !== id)].slice(0, MAX_RECENTS);
      persist();
    },
    clearFavorites() { favorites = []; persist(); },
    clearRecents() { recents = []; persist(); }
  };
}

export function parseAtlasLink(href) {
  const url = new URL(href);
  const scene = url.searchParams.get('scene');
  const body = url.searchParams.get('body');
  if (!scene && !body) return null;
  if (scene === 'planet' && validBodyIds.has(body)) return { scene, body };
  if (['galaxy', 'solar', 'free'].includes(scene) && !body) return { scene };
  return { scene: 'galaxy', invalid: true };
}

export function buildAtlasLink(href, scene, body = null) {
  const url = new URL(href);
  url.hash = '';
  url.searchParams.delete('body');
  if (scene === 'planet' && validBodyIds.has(body)) {
    url.searchParams.set('scene', 'planet');
    url.searchParams.set('body', body);
  } else {
    url.searchParams.set('scene', ['galaxy', 'solar', 'free'].includes(scene) ? scene : 'galaxy');
  }
  return url.href; // Preserve the existing GitHub Pages base pathname.
}
