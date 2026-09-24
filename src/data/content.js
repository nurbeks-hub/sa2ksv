// Content loader: structure facts & names are written by the content team into src/content/.
//   src/content/structures.json       [{id, la, sys, group, hide, role:{kk,ru,en}, kk_confidence, facts:[{kk,ru,en,src:{title,url}}]}]
//   src/content/names.{kk,ru,en}.json {id: name}
//   src/content/about.{kk,ru,en}.json {title, body:[…], simpl:[…], lic:[…]}  (overrides the ⓘ text)
// The source list shown in ⓘ is collected from the facts' src objects (deduplicated).
// Missing files fall back to the English Z-Anatomy names from assets/structures.json, and finally to a
// prettified node name. Content is only ever inserted with textContent (never as HTML); links only http(s).
const base = new URL('../content/', import.meta.url);

async function getJSON(url) {
  try {
    const r = await fetch(url, { cache: 'no-cache' });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

const pretty = (s) => String(s || '').trim().replace(/\.(l|r)$/, '').replace(/\*/g, '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim();

export async function loadContent(langs = ['kk', 'ru', 'en']) {
  const [structs, rawList, ...rest] = await Promise.all([
    getJSON(new URL('structures.json', base)),
    getJSON(new URL('../../assets/structures.json', import.meta.url)),
    ...langs.map(l => getJSON(new URL(`names.${l}.json`, base))),
    ...langs.map(l => getJSON(new URL(`about.${l}.json`, base))),
  ]);
  const names = {}, about = {};
  langs.forEach((l, i) => { names[l] = isObj(rest[i]) ? rest[i] : {}; about[l] = isObj(rest[langs.length + i]) ? rest[langs.length + i] : null; });
  const byId = {};
  if (Array.isArray(structs)) for (const s of structs) if (s && typeof s.id === 'string') byId[s.id] = s;
  const raw = {}; const nodeToId = {};
  if (Array.isArray(rawList)) for (const s of rawList) {
    if (!s || typeof s.id !== 'string') continue;
    raw[s.id] = pretty(s.name_en_raw || s.en_raw || s.id);
    for (const n of s.nodes || []) nodeToId[String(n).trim()] = s.id;
  }
  // unique sources across all facts (for the ⓘ list)
  const srcMap = {};
  for (const s of Object.values(byId)) {
    if (s.hide === true || !Array.isArray(s.facts)) continue;
    for (const f of s.facts) {
      const src = isObj(f) && isObj(f.src) ? f.src : null; if (!src) continue;
      const key = safeUrl(src.url) || str(src.title); if (!key || srcMap[key]) continue;
      srcMap[key] = { title: str(src.title) || key, url: safeUrl(src.url) };
    }
  }
  return {
    byId, names, raw, nodeToId, sources: srcMap, about,
    stats: { records: Object.keys(byId).length, sources: Object.keys(srcMap).length, names: Object.fromEntries(langs.map(l => [l, Object.keys(names[l]).length])) },
    name(id, lang) { return str(names[lang]?.[id]) || str(names.en?.[id]) || raw[id] || pretty(id.replace(/-/g, ' ')); },
    latin(id) { return str(byId[id]?.la); },
    role(id, lang) { const r = byId[id]?.role; return isObj(r) ? (str(r[lang]) || str(r.en)) : ''; },
    hidden(id) { return byId[id]?.hide === true; },
    facts(id) { const f = byId[id]?.facts; return Array.isArray(f) ? f.filter(isObj) : []; },
    source(ref) {
      if (ref == null) return null;
      if (isObj(ref)) return { title: str(ref.title) || str(ref.name) || '', url: safeUrl(ref.url) };
      if (typeof ref === 'string' && /^https?:\/\//.test(ref)) return { title: ref.replace(/^https?:\/\//, '').slice(0, 60), url: safeUrl(ref) };
      return { title: String(ref), url: null };
    },
  };
}
const isObj = (o) => o && typeof o === 'object' && !Array.isArray(o);
const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : '');
function safeUrl(u) { try { const x = new URL(String(u)); return /^https?:$/.test(x.protocol) ? x.href : null; } catch { return null; } }
