import * as cheerio from 'cheerio';

export class ParseError extends Error {
  /** @param {string} code */
  constructor(message, code = 'PARSE_ERROR') {
    super(message);
    this.name = 'ParseError';
    this.code = code;
  }
}

const SOURCE_RE = /\[?(\d*)?\]?\s*[Ss]ource/;
const IMAGE_EXT_RE = /\.(jpe?g|png|gif|webp)$/i;

/**
 * Parsed EQD source row (same shape as the legacy extension output).
 * @typedef {{ number?: string, name: string, images: string[] }} EqSourceRow
 */

/**
 * @param {string} eqdPageUrl
 * @param {string} html
 * @returns {EqSourceRow[]}
 */
export function parseEqdPostHtml(eqdPageUrl, html) {
  let base;
  try {
    base = new URL(eqdPageUrl).href;
  } catch {
    throw new ParseError('Invalid EQD page URL', 'INVALID_URL');
  }

  const $ = cheerio.load(html);
  const post = $('#Blog1 [itemprop="description articleBody"]').first();
  if (!post.length) {
    throw new ParseError('EQD article body not found (selector mismatch)', 'NO_ARTICLE');
  }

  const root = post.get(0);
  if (!root || root.type !== 'tag') {
    throw new ParseError('EQD article body has unexpected shape', 'NO_ARTICLE');
  }

  /** @type {Item[]} */
  const itemsOfInterest = [];
  walkNode($, root, base, itemsOfInterest);

  /** @type {{ source: Item, images: Item[] }[]} */
  const results = [];
  /** @type {Item[]} */
  const stack = [];
  buildSources(itemsOfInterest.slice(), stack, results);

  return results.map((r) => annotateResult(r));
}

/**
 * @typedef {{ name: 'source', content: string, url: string, number?: string } | { name: 'link', content: string, url: string } | { name: 'image', url: string }} Item
 */

/**
 * @param {import('cheerio').CheerioAPI} $
 * @param {*} el
 * @param {string} base
 * @param {Item[]} ioiList
 */
function walkNode($, el, base, ioiList) {
  if (el.type !== 'tag') return;

  const tag = el.name;

  if (tag === 'a') {
    const $a = $(el);
    const text = $a.text();
    const href = $a.attr('href');
    if (text && href) {
      const srcMatch = SOURCE_RE.exec(text);
      const imgMatch = IMAGE_EXT_RE.test(href);
      let abs;
      try {
        abs = new URL(href, base).href;
      } catch {
        abs = href;
      }
      if (srcMatch) {
        ioiList.push({
          name: 'source',
          content: text,
          url: abs,
          number: srcMatch[1] ?? '',
        });
      } else if (imgMatch) {
        ioiList.push({
          name: 'link',
          content: text,
          url: abs,
        });
      }
    }
  }

  if (tag === 'img') {
    const src = $(el).attr('src');
    if (src) {
      let abs;
      try {
        abs = new URL(src, base).href;
      } catch {
        abs = src;
      }
      ioiList.push({
        name: 'image',
        url: abs,
      });
    }
  }

  $(el)
    .children()
    .each((_, child) => {
      walkNode($, child, base, ioiList);
    });
}

/**
 * @param {Item[]} items
 * @param {Item[]} stack
 * @param {{ source: Item, images: Item[] }[]} results
 */
function buildSources(items, stack, results) {
  if (!items.length) {
    if (stack.length) buildSource(stack, results);
    return;
  }

  const item = items.shift();
  if (!item) return;

  if (item.name === 'image' || item.name === 'link') {
    stack.push(item);
    buildSources(items, stack, results);
    return;
  }

  if (item.name === 'source') {
    const stackHasSource = stack.some((x) => x.name === 'source');

    if (stackHasSource) {
      buildSource(stack, results);
      stack = [item];
    } else if (stack.length) {
      stack.push(item);
      buildSource(stack, results);
      stack = [];
    } else {
      stack.push(item);
    }
    buildSources(items, stack, results);
  }
}

/**
 * @param {Item[]} stack
 * @param {{ source: Item, images: Item[] }[]} results
 */
function buildSource(stack, results) {
  const source = stack.find((x) => x.name === 'source');
  if (!source) {
    throw new ParseError('Orphaned image or link without a preceding Source line', 'ORPHAN_MEDIA');
  }
  const images = stack.filter((x) => x.name === 'image' || x.name === 'link');
  results.push({ source, images });
}

/**
 * @param {{ source: Item, images: Item[] }} result
 * @returns {EqSourceRow}
 */
function annotateResult(result) {
  const output = {
    number: result.source.number,
    name: 'Other',
    images: /** @type {string[]} */ ([]),
  };

  const sourceUrl = result.source.url;
  const isDeviantArt = /deviantart\.com/i.test(sourceUrl);
  const isDerpi = /derpibooru\.org/i.test(sourceUrl);
  const isTwit = /(twitter|x)\.com/i.test(sourceUrl);

  if (isDeviantArt) {
    output.images.push(sourceUrl);
    output.name = 'Deviant Art';
    if (result.images.length > 1) {
      output.name = 'Deviant Art with additional images';
      output.images = output.images.concat(result.images.map((x) => x.url));
    }
  } else if (isDerpi) {
    output.images.push(sourceUrl);
    output.name = 'Derpibooru';
    if (result.images.length > 1) {
      output.name = 'Derpibooru with additional images';
      output.images = output.images.concat(result.images.map((x) => x.url));
    }
  } else if (isTwit) {
    output.images.push(sourceUrl);
    output.name = 'Twitter';
    if (result.images.length > 1) {
      output.name = 'Twitter with additional images';
      output.images = output.images.concat(result.images.map((x) => x.url));
    }
  } else {
    output.name = 'Other';
    output.images = result.images.map((x) => x.url);
  }

  return output;
}

/**
 * @param {string} url
 * @returns {'none'|'deviantart'|'derpibooru'|'twitter'}
 */
export function classifyResolveKind(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '').toLowerCase();
    if (host.endsWith('deviantart.com')) return 'deviantart';
    if (host.endsWith('derpibooru.org')) return 'derpibooru';
    if (host === 'twitter.com' || host.endsWith('.twitter.com')) return 'twitter';
    if (host === 'x.com' || host.endsWith('.x.com')) return 'twitter';
  } catch {
    /* ignore */
  }
  return 'none';
}

/**
 * @param {EqSourceRow[]} rows
 */
export function parseSourceNumberRanges(rows) {
  const sources = rows
    .map((s) => parseInt(String(s.number ?? ''), 10))
    .filter((n) => !Number.isNaN(n))
    .sort((a, b) => a - b);

  const duplicates = new Set();
  /** @type {(number|[number,number])[]} */
  const missing = [];

  if (!sources.length) {
    return {
      unknown: rows.length,
      duplicates: [],
      missing: [],
    };
  }

  let last = sources[0];
  for (let i = 1; i < sources.length; i++) {
    const cur = sources[i];
    if (last === cur) {
      duplicates.add(cur);
    } else if (last + 2 === cur) {
      missing.push(cur - 1);
    } else if (cur - last > 2) {
      missing.push([last + 1, cur - 1]);
    }
    last = cur;
  }

  return {
    unknown: rows.length - sources.length,
    duplicates: Array.from(duplicates),
    missing,
  };
}
