import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../docs/highlights.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../docs/index.html', import.meta.url), 'utf8');
const sample = {
  event: "GitHub Universe '26 keynote",
  count: 1,
  highlights: [{ id: 'one', topic: 'Agentic software development', title: '<img src=x onerror=alert(1)>', summary: '<script>bad()</script>', tryIt: 'javascript:bad()' }]
};
const topics = { topics: [{ name: 'Agentic software development', slug: 'agentic-software-development', count: 1 }] };

class Node {
  constructor(tag = '') {
    this.tag = tag;
    this.children = [];
    this.dataset = {};
    this.attributes = {};
    this.listeners = {};
    this.hidden = false;
    this.textContent = '';
  }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = [...nodes]; }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(name, fn) { this.listeners[name] = fn; }
  querySelectorAll() { return this.children.filter(node => node.tag === 'button'); }
  contains(node) { return this.children.includes(node); }
  closest() { return this.tag === 'button' ? this : null; }
  set innerHTML(_) { throw new Error('Unsafe HTML rendering'); }
}

function setup(fetcher, base) {
  const ids = Object.fromEntries(['keynote-highlights', 'topic-filters', 'highlight-grid', 'highlights-status', 'highlights-retry'].map(id => [id, new Node()]));
  if (base !== undefined) ids['keynote-highlights'].dataset.apiBase = base;
  const all = new Node('button');
  all.dataset.topic = '';
  ids['topic-filters'].append(all);
  const errors = [];
  vm.runInNewContext(source, {
    document: {
      getElementById: id => ids[id],
      createElement: tag => new Node(tag),
      createTextNode: text => Object.assign(new Node('#text'), { textContent: text })
    },
    fetch: fetcher,
    URL, URLSearchParams, AbortController, setTimeout, clearTimeout,
    console: { error: (...args) => errors.push(args) }
  });
  return { ids, errors, all };
}
const flush = () => new Promise(resolve => setImmediate(resolve));
const response = data => ({ ok: true, json: async () => data });
const text = node => node.textContent + node.children.map(text).join('');
const click = (ids, button) => ids['topic-filters'].listeners.click({ target: button });

test('loads API topics and safely renders every field as text', async () => {
  const calls = [];
  const { ids, all } = setup(async url => {
    calls.push(String(url));
    return response(url.pathname.endsWith('topics') ? topics : sample);
  });
  await flush();
  assert.deepEqual(calls.sort(), ['http://localhost:3001/api/highlights', 'http://localhost:3001/api/topics']);
  assert.equal(ids['highlight-grid'].children.length, 1);
  assert.match(text(ids['highlight-grid']), /<img src=x onerror=alert\(1\)>/);
  assert.match(text(ids['highlight-grid']), /<script>bad\(\)<\/script>/);
  assert.match(text(ids['highlight-grid']), /javascript:bad\(\)/);
  assert.equal(ids['highlights-status'].textContent, '1 highlight');
  assert.equal(all.attributes['aria-pressed'], 'true');
  const topic = ids['topic-filters'].children[1];
  assert.equal(topic.type, 'button');
  click(ids, topic);
  await flush();
  assert.equal(new URL(calls.at(-1)).searchParams.get('topic'), topics.topics[0].name);
  assert.equal(topic.attributes['aria-pressed'], 'true');
  assert.equal(all.attributes['aria-pressed'], 'false');
  assert.match(ids['highlights-status'].textContent, /for Agentic software development/);
  click(ids, all);
  await flush();
  assert.equal(new URL(calls.at(-1)).search, '');
});

test('uses configurable base and renders empty results', async () => {
  const calls = [];
  const { ids } = setup(async url => {
    calls.push(String(url));
    return response(url.pathname.endsWith('topics') ? topics : { ...sample, count: 0, highlights: [] });
  }, 'http://localhost:4321/');
  await flush();
  assert.ok(calls.every(url => url.startsWith('http://localhost:4321/api/')));
  assert.equal(ids['highlight-grid'].children.length, 0);
  assert.match(ids['highlights-status'].textContent, /0 highlights/);
});

test('reports network failures and retries initial topic loading', async () => {
  let failed = true;
  const { ids, errors } = setup(async url => {
    if (failed) throw new Error('offline');
    return response(url.pathname.endsWith('topics') ? topics : sample);
  });
  await flush();
  assert.equal(errors.length, 1);
  assert.equal(ids['highlights-retry'].hidden, false);
  assert.match(ids['highlights-status'].textContent, /unavailable.*recap/);
  assert.equal(ids['highlight-grid'].attributes['aria-busy'], 'false');
  failed = false;
  ids['highlights-retry'].listeners.click();
  await flush();
  assert.equal(ids['highlights-retry'].hidden, true);
  assert.equal(ids['topic-filters'].children.length, 2);
  assert.equal(ids['highlights-status'].textContent, '1 highlight');
});

test('rejects HTTP errors, malformed JSON shapes, and invalid base URLs', async () => {
  for (const fetcher of [
    async () => ({ ok: false, status: 500 }),
    async () => response({}),
    async url => response(url.pathname.endsWith('topics') ? topics : { ...sample, count: 6 }),
    async () => ({ ok: true, json: async () => { throw new SyntaxError('bad JSON'); } })
  ]) {
    const { ids, errors } = setup(fetcher);
    await flush();
    assert.equal(ids['highlights-retry'].hidden, false);
    assert.equal(errors.length, 1);
  }
  const { ids } = setup(() => { throw new Error('Must not fetch'); }, 'javascript:alert(1)');
  await flush();
  assert.equal(ids['highlights-retry'].hidden, false);
});

test('ignores stale requests during rapid filter changes', async () => {
  let finishOld;
  const { ids, all } = setup(async url => {
    if (url.search) return new Promise(resolve => { finishOld = () => resolve(response(sample)); });
    return response(url.pathname.endsWith('topics') ? topics : { ...sample, count: 0, highlights: [] });
  });
  await flush();
  click(ids, ids['topic-filters'].children[1]);
  click(ids, all);
  await flush();
  finishOld();
  await flush();
  assert.equal(all.attributes['aria-pressed'], 'true');
  assert.equal(ids['highlight-grid'].children.length, 0);
  assert.match(ids['highlights-status'].textContent, /0 highlights/);
});

test('keeps the section before the original CTA with native accessible controls', () => {
  assert.ok(html.indexOf('id="keynote-highlights"') < html.indexOf('class="keynote-cta"'));
  assert.match(html, /role="status" aria-live="polite" aria-atomic="true"/);
  assert.match(html, /class="topic-filter" type="button" aria-pressed="true"/);
  assert.match(html, /https:\/\/github\.com\/events\/universe\/recap\?/);
  assert.doesNotMatch(source, /innerHTML/);
});
