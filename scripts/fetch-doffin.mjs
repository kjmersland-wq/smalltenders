// Refreshes the Norwegian tenders from Doffin (https://www.doffin.no) and merges them into tenders*.json.
//
//   DOFFIN_API_KEY=...  node scripts/fetch-doffin.mjs            # fetch and merge
//   node scripts/fetch-doffin.mjs --probe                        # print the raw API answer for one search, change nothing
//
// The key is read from the DOFFIN_API_KEY environment variable, or from a local .env file (never committed).
// Optional: DOFFIN_API_BASE (default https://api.doffin.no/public/v2).
//
// - Every tender links to its own notice page: https://www.doffin.no/notices/<id>
// - Doffin is preferred for Norway: when it returns tenders they replace the Norwegian TED entries,
//   otherwise the TED entries stay as the fallback.
// - Requests are spaced 4 s apart (about 15 per minute).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- key from the environment, or from .env
if (!process.env.DOFFIN_API_KEY && existsSync(join(ROOT, '.env'))) {
  for (const line of readFileSync(join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}
const KEY = process.env.DOFFIN_API_KEY;
const BASE = (process.env.DOFFIN_API_BASE || 'https://api.doffin.no/public/v2').replace(/\/$/, '');
if (!KEY) { console.error('DOFFIN_API_KEY is not set (environment variable or .env file).'); process.exit(1); }

const PER_TRADE_TERMS = {
  electrical: ['elektro', 'elektriker'], plumbing: ['rørlegger', 'sanitær'], hvac: ['ventilasjon', 'varme'], painting: ['maling', 'malerarbeid'],
  building: ['byggearbeid', 'rehabilitering'], cleaning: ['renhold', 'rengjøring'], roofing: ['tak', 'taktekking'], flooring: ['gulv'],
  windows: ['vinduer', 'dører'], insulation: ['isolasjon'], facade: ['fasade'], groundworks: ['grunnarbeid', 'graving'], demolition: ['riving'], scaffolding: ['stillas']
};
// same CPV -> trade table as the TED script
const CPV = [['demolition', ['45110000', '45111000', '45111100']], ['groundworks', ['45112', '45111200']], ['scaffolding', ['45262100']], ['roofing', ['45261']], ['facade', ['45443']], ['insulation', ['45320']], ['windows', ['45421', '45441', '44221']], ['flooring', ['45430']], ['painting', ['45442', '45440']], ['plumbing', ['45330', '45332']], ['hvac', ['45331']], ['electrical', ['4531']], ['cleaning', ['9091']], ['building', ['4521', '45200']]];
const FIT = { en: 'for a small firm in this trade that can meet the scope and the deadline in the notice.', no: 'for et lite firma i dette faget som kan levere innenfor omfanget og fristen i kunngjøringen.', da: 'for en lille virksomhed i faget, som kan overholde omfanget og fristen i bekendtgørelsen.', sv: 'för ett litet företag i branschen som kan klara omfattningen och tidsfristen i annonsen.', fi: 'pienelle alan yritykselle, joka pystyy toteuttamaan työn ilmoituksen laajuudessa ja määräajassa.', is: 'fyrir lítið fyrirtæki í greininni sem getur staðið við umfang og frest auglýsingarinnar.', pl: 'dla małej firmy z tej branży, która sprosta zakresowi i terminowi z ogłoszenia.', de: 'für einen kleinen Betrieb dieses Gewerks, der Umfang und Frist der Bekanntmachung einhalten kann.', cs: 'pro malou firmu v oboru, která zvládne rozsah i lhůtu uvedené v oznámení.', sk: 'pre malú firmu v odbore, ktorá zvládne rozsah aj lehotu uvedené v oznámení.', nl: 'voor een klein bedrijf in dit vak dat de omvang en de deadline uit de aankondiging aankan.', lt: 'mažai įmonei šioje srityje, galinčiai įvykdyti skelbime nurodytą apimtį ir terminą.', ee: 'väikesele selle ala ettevõttele, kes saab hakkama teates toodud mahu ja tähtajaga.', lv: 'nelielam nozares uzņēmumam, kas var izpildīt paziņojumā norādīto apjomu un termiņu.', fr: 'pour une petite entreprise du métier qui peut respecter l’ampleur et le délai de l’avis.', es: 'para una pequeña empresa del oficio que pueda cumplir el alcance y el plazo del anuncio.', it: 'per una piccola impresa del settore che può rispettare l’entità e la scadenza dell’avviso.' };
const NOT_STATED = { en: 'Value not stated', no: 'Verdi ikke oppgitt', da: 'Værdi ikke oplyst', sv: 'Värde ej angivet', fi: 'Arvoa ei ilmoitettu', is: 'Verðmæti ekki gefið upp', pl: 'Wartość nie podana', de: 'Wert nicht angegeben', cs: 'Hodnota neuvedena', sk: 'Hodnota neuvedená', nl: 'Waarde niet vermeld', lt: 'Vertė nenurodyta', ee: 'Väärtus pole märgitud', lv: 'Vērtība nav norādīta', fr: 'Valeur non indiquée', es: 'Valor no indicado', it: 'Valore non indicato' };
const LOC = { en: 'en', no: 'nb', ee: 'et', at: 'de-AT', be: 'nl-BE' };
const FILES = { en: 'tenders.json' };
for (const c of ['no', 'da', 'sv', 'fi', 'is', 'pl', 'de', 'at', 'cs', 'sk', 'nl', 'be', 'lt', 'ee', 'lv', 'fr', 'es', 'it']) FILES[c] = `tenders.${c}.json`;
const VOCAB = JSON.parse(readFileSync(join(ROOT, 'scripts/vocab.json'), 'utf8'));
const vk = (c) => (c === 'at' ? 'de' : c);

// ---- Doffin
async function search(params, tries = 4) {
  const url = `${BASE}/search?` + new URLSearchParams(params);
  for (let i = 0; i < tries; i++) {
    const r = await fetch(url, { headers: { 'Ocp-Apim-Subscription-Key': KEY, Accept: 'application/json' } });
    if (r.ok) return r.json();
    if (r.status === 429) { await sleep(15000 * (i + 1)); continue; }
    throw new Error(`Doffin ${r.status}: ${(await r.text()).slice(0, 200)}`);
  }
  throw new Error('Doffin: too many retries');
}
const hitsOf = (j) => j.hits || j.notices || j.results || j.items || [];
const pick = (h, ...names) => { for (const n of names) if (h[n] != null && h[n] !== '') return h[n]; return null; };
const str = (v) => (v == null ? '' : typeof v === 'string' ? v : Array.isArray(v) ? str(v[0]) : v.name || v.title || v.text || v.city || v.value || Object.values(v).find((x) => typeof x === 'string') || '');
const day = (s) => (s ? String(s).slice(0, 10) : null);

function shortText(s, max = 320) {
  s = String(s || '').replace(/^\s*(Bakgrunn|Background|Beskrivelse av oppdraget)\s*\n+/i, '').replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max), dot = cut.lastIndexOf('. ');
  return dot > max * 0.5 ? cut.slice(0, dot + 1) : cut.replace(/\s+\S*$/, '') + '…';
}
function tradeOf(cpvs, title) {
  for (const [t, ps] of CPV) if ((cpvs || []).some((c) => ps.some((p) => String(c).startsWith(p)))) return t;
  const low = String(title || '').toLowerCase();
  for (const [t, words] of Object.entries(PER_TRADE_TERMS)) if (words.some((w) => low.includes(w))) return t;
  return null;
}

if (process.argv.includes('--probe')) {
  const j = await search({ searchString: 'maling', status: 'ACTIVE', numHitsPerPage: 2, page: 1 });
  console.log(JSON.stringify(j, null, 1).slice(0, 6000));
  process.exit(0);
}

const found = new Map();
for (const [trade, terms] of Object.entries(PER_TRADE_TERMS).slice(0, +(process.env.ONLY_TRADES || 99))) {
  for (const term of terms) {
    try {
      const hits = [];
      for (let page = 1; page <= 3; page++) {
        const j = await search({ searchString: term, status: 'ACTIVE', numHitsPerPage: 40, page });
        hits.push(...hitsOf(j));
        if (hitsOf(j).length < 40) break;
        await sleep(4000);
      }
      for (const h of hits) {
        const id = String(pick(h, 'id', 'noticeId', 'doffinId') || '');
        if (!id || found.has(id)) continue;
        const title = str(pick(h, 'heading', 'title'));
        const deadline = day(pick(h, 'deadline'));
        if (h.type && !/COMPETITION/.test(h.type)) continue;
        const cpv = [].concat(pick(h, 'cpvCodes', 'cpv', 'cpvCode') || []).map((c) => (typeof c === 'object' ? c.code || c.id : c)).filter(Boolean);
        const t = tradeOf(cpv, title) || trade;
        if (!title || !deadline || new Date(deadline) < new Date(Date.now() + 3 * 864e5)) continue;
        const buyer = str(pick(h, 'buyer')), place = '';
        const ev = pick(h, 'estimatedValue', 'value');
        const amount = ev && typeof ev === 'object' ? Number(ev.amount ?? ev.value) : Number(ev);
        found.set(id, { id, title, deadline, trade: t, place, buyer: buyer, description: str(pick(h, 'description')), published: day(pick(h, 'issueDate', 'publicationDate', 'publishedDate')), value: amount > 0 ? { amount, cur: (ev && ev.currencyCode) || 'NOK' } : null });
      }
      console.log(term, '->', found.size, 'tenders so far');
    } catch (e) { console.log(term, 'skipped:', e.message); }
    await sleep(4000);
  }
}

// ---- pick candidates, then read each notice's XML (buyer city, contact person) and geocode the buyer's city
const GEO_FILE = join(ROOT, 'scripts/geocache.json');
const geo = existsSync(GEO_FILE) ? JSON.parse(readFileSync(GEO_FILE, 'utf8')) : {};
async function geocode(city) {
  const key = 'NO|' + city.toLowerCase();
  if (key in geo) return geo[key];
  await sleep(1200);
  const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=1&accept-language=en&countrycodes=no&q=${encodeURIComponent(city)}`, { headers: { 'user-agent': 'smalltenders.com tender fetcher (support@smalltenders.com)' } });
  let res = null;
  if (r.ok) { const j = await r.json(); if (j[0]) { const a = j[0].address || {}; res = { lat: +(+j[0].lat).toFixed(3), lng: +(+j[0].lon).toFixed(3), region: a.state || a.county || '' }; } }
  geo[key] = res; writeFileSync(GEO_FILE, JSON.stringify(geo, null, 1));
  return res;
}
const unxml = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
const tag = (xml, name) => { const m = new RegExp('<cbc:' + name + '[^>]*>([^<]*)</cbc:' + name + '>').exec(xml); return m ? unxml(m[1]).trim() : ''; };
const tidyCity = (c) => (c === c.toUpperCase() && c.length > 3 ? c.toLowerCase().replace(/(^|[\s\-])\p{L}/gu, (m) => m.toUpperCase()) : c);
async function notice(id) {   // eForms XML of the notice: the first organisation is the buyer
  const r = await fetch(`${BASE}/download/${id}`, { headers: { 'Ocp-Apim-Subscription-Key': KEY } });
  if (!r.ok) return null;
  const xml = await r.text(), o = /<efac:Company>([\s\S]*?)<\/efac:Company>/.exec(xml);
  if (!o) return null;
  const co = /<cac:Contact>([\s\S]*?)<\/cac:Contact>/.exec(o[1]);
  const c = co ? { name: tag(co[1], 'Name'), email: tag(co[1], 'ElectronicMail'), phone: tag(co[1], 'Telephone') } : {};
  for (const k of Object.keys(c)) if (!c[k]) delete c[k];
  const web = tag(o[1], 'WebsiteURI'); if (web) c.web = web;
  return { city: tidyCity(tag(/<cac:PostalAddress>([\s\S]*?)<\/cac:PostalAddress>/.exec(o[1])?.[1] || '', 'CityName')), contact: Object.keys(c).length ? c : null };
}
const ranked = [...found.values()].sort((a, b) => (b.published || '').localeCompare(a.published || ''));
const perTrade = {}, candidates = [];
for (const t of ranked) { if (candidates.length >= 24 || (perTrade[t.trade] || 0) >= 3) continue; perTrade[t.trade] = (perTrade[t.trade] || 0) + 1; candidates.push(t); }
const picked = [];
for (const t of candidates) {
  await sleep(4000);
  try {
    const n = await notice(t.id);
    const city = (n && n.city) || t.place;
    if (!city) continue;
    const g = await geocode(city);
    if (g) picked.push({ ...t, g, city, contact: n && n.contact });
  } catch (e) { console.log(t.id, 'skipped:', e.message); }
}
console.log('Doffin tenders kept:', picked.length);

// ---- merge: Doffin replaces Norwegian TED entries when it has any
for (const [code, file] of Object.entries(FILES)) {
  const p = join(ROOT, file), j = JSON.parse(readFileSync(p, 'utf8')), loc = LOC[code] || code, V = VOCAB[vk(code)];
  let names; try { names = new Intl.DisplayNames([loc], { type: 'region' }).of('NO'); } catch { names = 'Norway'; }
  const doffin = picked.map((t) => {
    let value = NOT_STATED[vk(code)] || NOT_STATED.en;
    if (t.value) { try { value = new Intl.NumberFormat(loc, { style: 'currency', currency: t.value.cur, notation: 'compact', maximumFractionDigits: 1 }).format(t.value.amount); } catch { /* keep default */ } }
    return { id: 'doffin-' + t.id, country: 'NO', countryName: names, city: t.city, region: t.g.region || t.city, lat: t.g.lat, lng: t.g.lng, trade: t.trade, tradeName: V.tradeName[t.trade], title: t.title, buyer: t.buyer, description: shortText(t.description), contact: t.contact || undefined, deadline: t.deadline, value, source: 'Doffin', fit: FIT[vk(code)] || FIT.en, link: `https://www.doffin.no/notices/${t.id}`, published: t.published };
  });
  if (picked.length) j.tenders = [...doffin, ...j.tenders.filter((t) => t.country !== 'NO')];
  writeFileSync(p, JSON.stringify(j, null, 1));
}
console.log(picked.length ? 'Norwegian tenders now come from Doffin.' : 'Doffin gave nothing; Norwegian TED entries kept.');
