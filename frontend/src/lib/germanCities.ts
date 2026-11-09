/**
 * germanCities.ts – City → viewBox-coordinate lookup for the geographic
 * network map, plus a default postcode per city.
 *
 * The table holds the large German cities and the university-hospital towns,
 * each with its central postcode. A site's city field is matched loosely:
 * case, umlauts (ä→ae etc.), punctuation and whitespace do not matter, a
 * postcode written into the field ("48149 Münster") is split off, and
 * suffixes are tolerated ("Münster (Westf.)", "Berlin-Buch", "Halle/Saale",
 * "Frankfurt a.M."). When the name is unknown but the site has a postcode
 * (its own field or one inside the city field), the pin goes to the main
 * town of that postcode region (first two digits).
 *
 * Only what is left after that gets a deterministic position in the
 * right-edge "Sonstige" stripe via djb2 hashing, so test fixtures and
 * yet-to-be-mapped places still render — outside the silhouette with a `?`.
 *
 * The default postcode is for display only: a site's own postcode always
 * wins, and nothing derived here is stored.
 *
 * ViewBox: 0 0 700 800. The Wikimedia Karte_Deutschland.svg (native
 * 591.504 × 800.504) renders at its native size at (0, 0); the right-side
 * margin (x ∈ [600, 700]) holds the Sonstige stripe + space for legends.
 *
 * Coordinates derived by calibrating against actual Wikimedia state path
 * centroids (Berlin = (481, 256), Hamburg = (268, 154)):
 *   x = lon · 62.4 − 355
 *   y = 5720 − lat · 104
 * Sonstige stripe (unknown cities): x ∈ [620, 660], y ∈ [140, 720].
 */

export interface CityEntry {
  /** Official spelling, used for display. */
  name: string;
  /** Central postcode of the city (display default when a site has none). */
  postalCode: string;
  coord: [number, number];
}

// Generated from lat/lon with the projection above.
export const GERMAN_CITIES: Record<string, CityEntry> = {
  berlin: { name: 'Berlin', postalCode: '10117', coord: [481, 257] },
  hamburg: { name: 'Hamburg', postalCode: '20095', coord: [269, 149] },
  muenchen: { name: 'München', postalCode: '80331', coord: [367, 714] },
  koeln: { name: 'Köln', postalCode: '50667', coord: [79, 422] },
  'frankfurt am main': { name: 'Frankfurt am Main', postalCode: '60311', coord: [187, 508] },
  stuttgart: { name: 'Stuttgart', postalCode: '70173', coord: [218, 645] },
  duesseldorf: { name: 'Düsseldorf', postalCode: '40213', coord: [68, 392] },
  leipzig: { name: 'Leipzig', postalCode: '04109', coord: [417, 380] },
  dortmund: { name: 'Dortmund', postalCode: '44137', coord: [111, 363] },
  essen: { name: 'Essen', postalCode: '45127', coord: [82, 369] },
  bremen: { name: 'Bremen', postalCode: '28195', coord: [195, 199] },
  dresden: { name: 'Dresden', postalCode: '01067', coord: [502, 411] },
  hannover: { name: 'Hannover', postalCode: '30159', coord: [253, 273] },
  nuernberg: { name: 'Nürnberg', postalCode: '90402', coord: [336, 577] },
  duisburg: { name: 'Duisburg', postalCode: '47051', coord: [67, 371] },
  bochum: { name: 'Bochum', postalCode: '44787', coord: [96, 366] },
  wuppertal: { name: 'Wuppertal', postalCode: '42103', coord: [91, 389] },
  bielefeld: { name: 'Bielefeld', postalCode: '33602', coord: [177, 308] },
  bonn: { name: 'Bonn', postalCode: '53111', coord: [88, 443] },
  muenster: { name: 'Münster', postalCode: '48143', coord: [121, 316] },
  mannheim: { name: 'Mannheim', postalCode: '68159', coord: [173, 571] },
  karlsruhe: { name: 'Karlsruhe', postalCode: '76133', coord: [169, 624] },
  augsburg: { name: 'Augsburg', postalCode: '86150', coord: [325, 690] },
  wiesbaden: { name: 'Wiesbaden', postalCode: '65183', coord: [159, 511] },
  moenchengladbach: { name: 'Mönchengladbach', postalCode: '41061', coord: [47, 397] },
  gelsenkirchen: { name: 'Gelsenkirchen', postalCode: '45879', coord: [87, 362] },
  aachen: { name: 'Aachen', postalCode: '52062', coord: [25, 440] },
  braunschweig: { name: 'Braunschweig', postalCode: '38100', coord: [301, 283] },
  kiel: { name: 'Kiel', postalCode: '24103', coord: [277, 71] },
  chemnitz: { name: 'Chemnitz', postalCode: '09111', coord: [451, 433] },
  'halle saale': { name: 'Halle (Saale)', postalCode: '06108', coord: [392, 366] },
  magdeburg: { name: 'Magdeburg', postalCode: '39104', coord: [371, 299] },
  'freiburg im breisgau': { name: 'Freiburg im Breisgau', postalCode: '79098', coord: [134, 729] },
  krefeld: { name: 'Krefeld', postalCode: '47798', coord: [54, 380] },
  mainz: { name: 'Mainz', postalCode: '55116', coord: [161, 521] },
  luebeck: { name: 'Lübeck', postalCode: '23552', coord: [312, 118] },
  erfurt: { name: 'Erfurt', postalCode: '99084', coord: [333, 418] },
  oberhausen: { name: 'Oberhausen', postalCode: '46045', coord: [73, 367] },
  rostock: { name: 'Rostock', postalCode: '18055', coord: [403, 95] },
  kassel: { name: 'Kassel', postalCode: '34117', coord: [237, 384] },
  hagen: { name: 'Hagen', postalCode: '58095', coord: [111, 378] },
  potsdam: { name: 'Potsdam', postalCode: '14467', coord: [460, 271] },
  saarbruecken: { name: 'Saarbrücken', postalCode: '66111', coord: [81, 599] },
  hamm: { name: 'Hamm', postalCode: '59065', coord: [133, 345] },
  'ludwigshafen am rhein': {
    name: 'Ludwigshafen am Rhein',
    postalCode: '67059',
    coord: [172, 574],
  },
  oldenburg: { name: 'Oldenburg', postalCode: '26122', coord: [157, 193] },
  'muelheim an der ruhr': { name: 'Mülheim an der Ruhr', postalCode: '45468', coord: [74, 371] },
  osnabrueck: { name: 'Osnabrück', postalCode: '49074', coord: [147, 282] },
  leverkusen: { name: 'Leverkusen', postalCode: '51373', coord: [81, 411] },
  darmstadt: { name: 'Darmstadt', postalCode: '64283', coord: [185, 533] },
  heidelberg: { name: 'Heidelberg', postalCode: '69117', coord: [187, 582] },
  solingen: { name: 'Solingen', postalCode: '42651', coord: [87, 398] },
  herne: { name: 'Herne', postalCode: '44623', coord: [96, 360] },
  neuss: { name: 'Neuss', postalCode: '41460', coord: [63, 395] },
  regensburg: { name: 'Regensburg', postalCode: '93047', coord: [400, 623] },
  paderborn: { name: 'Paderborn', postalCode: '33098', coord: [192, 341] },
  ingolstadt: { name: 'Ingolstadt', postalCode: '85049', coord: [358, 648] },
  'offenbach am main': { name: 'Offenbach am Main', postalCode: '63065', coord: [193, 510] },
  fuerth: { name: 'Fürth', postalCode: '90762', coord: [331, 574] },
  wuerzburg: { name: 'Würzburg', postalCode: '97070', coord: [264, 542] },
  ulm: { name: 'Ulm', postalCode: '89073', coord: [268, 684] },
  heilbronn: { name: 'Heilbronn', postalCode: '74072', coord: [220, 609] },
  pforzheim: { name: 'Pforzheim', postalCode: '75175', coord: [188, 635] },
  wolfsburg: { name: 'Wolfsburg', postalCode: '38440', coord: [318, 268] },
  goettingen: { name: 'Göttingen', postalCode: '37073', coord: [264, 361] },
  bottrop: { name: 'Bottrop', postalCode: '46236', coord: [77, 362] },
  reutlingen: { name: 'Reutlingen', postalCode: '72764', coord: [219, 677] },
  koblenz: { name: 'Koblenz', postalCode: '56068', coord: [119, 483] },
  bremerhaven: { name: 'Bremerhaven', postalCode: '27568', coord: [180, 152] },
  recklinghausen: { name: 'Recklinghausen', postalCode: '45657', coord: [94, 352] },
  'bergisch gladbach': { name: 'Bergisch Gladbach', postalCode: '51465', coord: [90, 417] },
  erlangen: { name: 'Erlangen', postalCode: '91054', coord: [332, 563] },
  jena: { name: 'Jena', postalCode: '07743', coord: [368, 423] },
  remscheid: { name: 'Remscheid', postalCode: '42853', coord: [94, 397] },
  trier: { name: 'Trier', postalCode: '54290', coord: [59, 546] },
  salzgitter: { name: 'Salzgitter', postalCode: '38226', coord: [290, 296] },
  moers: { name: 'Moers', postalCode: '47441', coord: [59, 369] },
  siegen: { name: 'Siegen', postalCode: '57072', coord: [146, 429] },
  hildesheim: { name: 'Hildesheim', postalCode: '31134', coord: [266, 296] },
  cottbus: { name: 'Cottbus', postalCode: '03046', coord: [539, 337] },
  guetersloh: { name: 'Gütersloh', postalCode: '33330', coord: [168, 322] },
  kaiserslautern: { name: 'Kaiserslautern', postalCode: '67655', coord: [130, 578] },
  schwerin: { name: 'Schwerin', postalCode: '19053', coord: [356, 142] },
  witten: { name: 'Witten', postalCode: '58452', coord: [104, 370] },
  gera: { name: 'Gera', postalCode: '07545', coord: [399, 428] },
  iserlohn: { name: 'Iserlohn', postalCode: '58636', coord: [126, 377] },
  zwickau: { name: 'Zwickau', postalCode: '08056', coord: [425, 445] },
  dueren: { name: 'Düren', postalCode: '52349', coord: [50, 436] },
  'esslingen am neckar': { name: 'Esslingen am Neckar', postalCode: '73728', coord: [226, 651] },
  ludwigsburg: { name: 'Ludwigsburg', postalCode: '71638', coord: [219, 635] },
  hanau: { name: 'Hanau', postalCode: '63450', coord: [201, 506] },
  flensburg: { name: 'Flensburg', postalCode: '24937', coord: [234, 22] },
  tuebingen: { name: 'Tübingen', postalCode: '72070', coord: [210, 671] },
  marburg: { name: 'Marburg', postalCode: '35037', coord: [192, 436] },
  giessen: { name: 'Gießen', postalCode: '35390', coord: [187, 459] },
  greifswald: { name: 'Greifswald', postalCode: '17489', coord: [480, 95] },
  homburg: { name: 'Homburg', postalCode: '66424', coord: [103, 590] },
  'bad oeynhausen': { name: 'Bad Oeynhausen', postalCode: '32545', coord: [194, 291] },
  'frankfurt oder': { name: 'Frankfurt (Oder)', postalCode: '15230', coord: [553, 276] },
  konstanz: { name: 'Konstanz', postalCode: '78462', coord: [218, 763] },
  bayreuth: { name: 'Bayreuth', postalCode: '95444', coord: [367, 526] },
  bamberg: { name: 'Bamberg', postalCode: '96047', coord: [325, 531] },
  passau: { name: 'Passau', postalCode: '94032', coord: [485, 668] },
  rosenheim: { name: 'Rosenheim', postalCode: '83022', coord: [402, 743] },
  'kempten allgaeu': { name: 'Kempten (Allgäu)', postalCode: '87435', coord: [289, 756] },
  neubrandenburg: { name: 'Neubrandenburg', postalCode: '17033', coord: [472, 150] },
  stralsund: { name: 'Stralsund', postalCode: '18439', coord: [461, 72] },
  'dessau-rosslau': { name: 'Dessau-Roßlau', postalCode: '06844', coord: [409, 329] },
  'brandenburg an der havel': {
    name: 'Brandenburg an der Havel',
    postalCode: '14776',
    coord: [428, 269],
  },
  wilhelmshaven: { name: 'Wilhelmshaven', postalCode: '26382', coord: [151, 153] },
  lueneburg: { name: 'Lüneburg', postalCode: '21335', coord: [294, 182] },
  celle: { name: 'Celle', postalCode: '29221', coord: [274, 247] },
  minden: { name: 'Minden', postalCode: '32423', coord: [201, 282] },
  detmold: { name: 'Detmold', postalCode: '32756', coord: [199, 319] },
  'villingen-schwenningen': {
    name: 'Villingen-Schwenningen',
    postalCode: '78050',
    coord: [173, 722],
  },
  offenburg: { name: 'Offenburg', postalCode: '77652', coord: [141, 679] },
  friedrichshafen: { name: 'Friedrichshafen', postalCode: '88045', coord: [236, 764] },
  ravensburg: { name: 'Ravensburg', postalCode: '88212', coord: [245, 751] },
  fulda: { name: 'Fulda', postalCode: '36037', coord: [249, 462] },
  weimar: { name: 'Weimar', postalCode: '99423', coord: [352, 418] },
  suhl: { name: 'Suhl', postalCode: '98527', coord: [312, 457] },
  nordhausen: { name: 'Nordhausen', postalCode: '99734', coord: [318, 363] },
  plauen: { name: 'Plauen', postalCode: '08523', coord: [402, 469] },
  goerlitz: { name: 'Görlitz', postalCode: '02826', coord: [580, 400] },
  bautzen: { name: 'Bautzen', postalCode: '02625', coord: [545, 397] },
  hof: { name: 'Hof', postalCode: '95028', coord: [388, 487] },
  landshut: { name: 'Landshut', postalCode: '84028', coord: [403, 672] },
  straubing: { name: 'Straubing', postalCode: '94315', coord: [430, 636] },
  aschaffenburg: { name: 'Aschaffenburg', postalCode: '63739', coord: [216, 522] },
  schweinfurt: { name: 'Schweinfurt', postalCode: '97421', coord: [284, 515] },
  worms: { name: 'Worms', postalCode: '67547', coord: [167, 558] },
  speyer: { name: 'Speyer', postalCode: '67346', coord: [172, 591] },
  'bad nauheim': { name: 'Bad Nauheim', postalCode: '61231', coord: [191, 482] },
};

/** Other spellings of an entry above: short forms and English names. */
const CITY_ALIASES: Record<string, string> = {
  frankfurt: 'frankfurt am main',
  'frankfurt main': 'frankfurt am main',
  'frankfurt a m': 'frankfurt am main',
  'frankfurt an der oder': 'frankfurt oder',
  halle: 'halle saale',
  'halle an der saale': 'halle saale',
  freiburg: 'freiburg im breisgau',
  'freiburg i br': 'freiburg im breisgau',
  'freiburg breisgau': 'freiburg im breisgau',
  muelheim: 'muelheim an der ruhr',
  'muelheim ruhr': 'muelheim an der ruhr',
  'muelheim a d ruhr': 'muelheim an der ruhr',
  ludwigshafen: 'ludwigshafen am rhein',
  offenbach: 'offenbach am main',
  esslingen: 'esslingen am neckar',
  kempten: 'kempten allgaeu',
  brandenburg: 'brandenburg an der havel',
  dessau: 'dessau-rosslau',
  'homburg saar': 'homburg',
  'oldenburg oldb': 'oldenburg',
  munich: 'muenchen',
  cologne: 'koeln',
  nuremberg: 'nuernberg',
  hanover: 'hannover',
  brunswick: 'braunschweig',
};

/** Leitregion (first two postcode digits) → coordinate of its main town. */
const POSTCODE_REGIONS: Record<string, [number, number]> = {
  '01': [502, 411],
  '02': [545, 397],
  '03': [539, 337],
  '04': [417, 381],
  '06': [392, 366],
  '07': [368, 424],
  '08': [425, 445],
  '09': [451, 433],
  '10': [481, 258],
  '11': [481, 258],
  '12': [481, 258],
  '13': [481, 258],
  '14': [460, 271],
  '15': [553, 276],
  '16': [471, 234],
  '17': [472, 150],
  '18': [400, 94],
  '19': [356, 142],
  '20': [269, 151],
  '21': [294, 182],
  '22': [269, 151],
  '23': [312, 118],
  '24': [277, 70],
  '25': [239, 112],
  '26': [158, 193],
  '27': [180, 152],
  '28': [194, 200],
  '29': [274, 247],
  '30': [252, 273],
  '31': [266, 296],
  '32': [186, 300],
  '33': [177, 310],
  '34': [237, 384],
  '35': [187, 459],
  '36': [249, 462],
  '37': [264, 360],
  '38': [302, 284],
  '39': [371, 299],
  '40': [68, 392],
  '41': [47, 397],
  '42': [91, 389],
  '44': [111, 363],
  '45': [83, 369],
  '46': [73, 367],
  '47': [67, 371],
  '48': [121, 316],
  '49': [147, 283],
  '50': [79, 422],
  '51': [90, 417],
  '52': [25, 439],
  '53': [88, 443],
  '54': [59, 546],
  '55': [161, 520],
  '56': [119, 483],
  '57': [146, 429],
  '58': [111, 378],
  '59': [133, 345],
  '60': [187, 509],
  '61': [183, 496],
  '63': [201, 506],
  '64': [185, 533],
  '65': [159, 512],
  '66': [82, 600],
  '67': [153, 588],
  '68': [173, 573],
  '69': [186, 583],
  '70': [218, 647],
  '71': [219, 635],
  '72': [210, 674],
  '73': [247, 655],
  '74': [220, 609],
  '75': [188, 635],
  '76': [169, 623],
  '77': [141, 679],
  '78': [173, 722],
  '79': [134, 728],
  '80': [367, 714],
  '81': [367, 714],
  '82': [353, 728],
  '83': [402, 743],
  '84': [403, 672],
  '85': [378, 686],
  '86': [325, 690],
  '87': [289, 756],
  '88': [245, 751],
  '89': [268, 686],
  '90': [336, 577],
  '91': [332, 563],
  '92': [385, 578],
  '93': [400, 623],
  '94': [485, 668],
  '95': [367, 526],
  '96': [325, 531],
  '97': [266, 542],
  '98': [312, 457],
  '99': [333, 418],
};

/** A German postcode inside free text, optionally prefixed with "D-". */
const POSTCODE_IN_TEXT = /(?:\bD-?\s*)?\b(\d{5})\b/i;

/** Lower-case, umlauts spelled out, other accents and punctuation dropped. */
function normalize(name: string): string {
  return name
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[()/,.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Splits a postcode written into the city field from the place name. */
export function parseCityField(raw: string | null | undefined): {
  name: string;
  postalCode: string | null;
} {
  if (!raw) return { name: '', postalCode: null };
  const match = POSTCODE_IN_TEXT.exec(raw);
  if (!match) return { name: raw.trim(), postalCode: null };
  const name = `${raw.slice(0, match.index)} ${raw.slice(match.index + match[0].length)}`
    .replace(/\s+/g, ' ')
    .replace(/^[\s,-]+|[\s,-]+$/g, '');
  return { name, postalCode: match[1] };
}

/** Table key of the city a free-text city field names, or null. */
function resolveKey(raw: string | null | undefined): string | null {
  const key = normalize(parseCityField(raw).name);
  if (!key) return null;
  const candidates = [key];
  // "Berlin-Buch" → "berlin"; hyphenated official names match first.
  if (key.includes('-')) candidates.push(key.split('-')[0].trim());
  // "muenster westf" → "muenster"
  const words = key.split(' ');
  for (let n = words.length - 1; n >= 1; n--) candidates.push(words.slice(0, n).join(' '));
  for (const c of candidates) {
    if (GERMAN_CITIES[c]) return c;
    const alias = CITY_ALIASES[c];
    if (alias && GERMAN_CITIES[alias]) return alias;
  }
  return null;
}

/** The table entry a free-text city field names, or null. */
export function resolveCity(raw: string | null | undefined): CityEntry | null {
  const key = resolveKey(raw);
  return key ? GERMAN_CITIES[key] : null;
}

export function cityCoord(name: string | null | undefined): [number, number] | null {
  return resolveCity(name)?.coord ?? null;
}

/** Coordinate of the main town of a postcode's region, or null. */
export function postcodeCoord(postalCode: string | null | undefined): [number, number] | null {
  const digits = postalCode?.trim();
  if (!digits || !/^\d{5}$/.test(digits)) return null;
  return POSTCODE_REGIONS[digits.slice(0, 2)] ?? null;
}

/**
 * The site's own postcode (field or written into the city), else the
 * default postcode of its city. `derived` marks the default.
 */
export function displayPostalCode(
  city: string | null | undefined,
  postalCode?: string | null,
): { code: string; derived: boolean } | null {
  const own = postalCode?.trim() || parseCityField(city).postalCode;
  if (own) return { code: own, derived: false };
  const entry = resolveCity(city);
  return entry ? { code: entry.postalCode, derived: true } : null;
}

// djb2 hash → uint32. Stable across browsers / Node, no Web Crypto needed.
function djb2(s: string): number {
  let hash = 5381;
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) + hash + s.charCodeAt(i)) >>> 0;
  }
  return hash;
}

const SONSTIGE_X_MIN = 620;
const SONSTIGE_X_MAX = 660;
const SONSTIGE_Y_MIN = 140;
const SONSTIGE_Y_MAX = 720;

export function unknownCityCoord(name: string): [number, number] {
  const h = djb2(name || '_');
  const x = SONSTIGE_X_MIN + (h % (SONSTIGE_X_MAX - SONSTIGE_X_MIN + 1));
  const y = SONSTIGE_Y_MIN + ((h >>> 8) % (SONSTIGE_Y_MAX - SONSTIGE_Y_MIN + 1));
  return [x, y];
}

/** Spread of places that share a postcode region, so their pins do not stack. */
const REGION_JITTER = 6;

export function getPinCoord(
  name: string | null | undefined,
  postalCode?: string | null,
): {
  coord: [number, number];
  known: boolean;
} {
  const known = cityCoord(name);
  if (known) return { coord: known, known: true };
  const region = postcodeCoord(postalCode?.trim() || parseCityField(name).postalCode);
  if (region) {
    const h = djb2(normalize(name ?? ''));
    const dx = (h % (2 * REGION_JITTER + 1)) - REGION_JITTER;
    const dy = ((h >>> 8) % (2 * REGION_JITTER + 1)) - REGION_JITTER;
    return { coord: [region[0] + dx, region[1] + dy], known: true };
  }
  return { coord: unknownCityCoord(name ?? ''), known: false };
}

/**
 * Stable bucket key for the geographic map. Used both as the cluster
 * grouping key and as the cluster `selectedId`. Centralized here so
 * cluster click-through can never drift between writer and reader.
 * Spellings of the same table city ("Münster", "48149 Münster") share
 * one bucket.
 */
export function cityBucketKey(
  city: string | null | undefined,
  countryCode: string | null | undefined,
): string {
  const cityKey = resolveKey(city) ?? normalize(parseCityField(city).name);
  const country = countryCode ?? 'DE';
  return `${cityKey || '__unknown__'}|${country}`;
}
