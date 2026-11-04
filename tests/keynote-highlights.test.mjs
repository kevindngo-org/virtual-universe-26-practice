import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../docs/highlights.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../docs/index.html', import.meta.url), 'utf8');
const item = {
  id: 'one', topic: 'Agentic software development', title: 'Build with agents',
  summary: 'A sample highlight', tryIt: 'Try the workshop'
};
const topicData = { topics: [
  { name: item.topic, slug: 'agentic-software-development', count: 1 },
  { name: 'Open source maintainers', slug: 'open-source-maintainers', count: 0 }
] };
const flush = () => new Promise(resolve => setImmediate(resolve));

class Element {
  children = [];
  attributes = {};
  listeners = {};
  dataset = {};
  hidden = false;
  textContent = '';
  constructor(tagName) { this.tagName = tagName; }
  setAttribute(name, value) { this.attributes[name] = value; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  addEventListener(name, callback) { this.listeners[name] = callback; }
  click() { this.listeners.click(); }
}

async function harness({ base, fetcher } = {}) {
  const elements = Object.fromEntries(
    ['keynote-highlights', 'topic-filters', 'highlight-grid', 'highlights-status', 'highlights-retry']
      .map(id => [id, new Element('div')])
  );
  if (base) elements['keynote-highlights'].dataset.apiBase = base;
  const calls = [];
  const errors = [];
  vm.runInNewContext(source, {
    document: {
      getElementById: id => elements[id],
      createElement: tag => new Element(tag),
      createTextNode: text => ({ textContent: text })
    },
    URL, AbortController, setTimeout, clearTimeout,
    console: { error: (...args) => errors.push(args) },
    fetch: async (url, options) => {
      calls.push(url);
      if (fetcher) return fetcher(url, options);
      return { ok: true, json: async () => url.pathname.endsWith('/topics')
        ? topicData : { count: 1, highlights: [item] } };
    }
  });
  await flush();
  return { elements, calls, errors };
}

test('section precedes unchanged CTA and uses a text-only external renderer', () => {
  assert.ok(html.indexOf('id="keynote-highlights"') < html.indexOf('<section class="keynote-cta"'));
  assert.match(html, /data-api-base="http:\/\/localhost:3001"/);
  assert.match(html, /id="highlights-status" role="status" aria-live="polite"/);
  assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML/);
});

test('loads API topic names, counts highlights, and renders every content field', async () => {
  const { elements, calls } = await harness();
  assert.equal(calls[0].origin, 'http://localhost:3001');
  const buttons = elements['topic-filters'].children;
  assert.deepEqual(buttons.map(button => button.textContent), ['All', item.topic, 'Open source maintainers']);
  assert.equal(buttons[0].attributes['aria-pressed'], 'true');
  assert.ok(buttons.every(button => button.type === 'button'));
  assert.equal(elements['highlights-status'].textContent, '1 highlight');
  assert.equal(elements['highlight-grid'].attributes['aria-busy'], 'false');
  const card = elements['highlight-grid'].children[0];
  assert.equal(card.children[0].textContent, item.topic);
  assert.equal(card.children[1].textContent, item.title);
  assert.equal(card.children[2].textContent, item.summary);
  assert.equal(card.children[3].children[1].textContent, item.tryIt);
});

test('queries topic NAME, updates exclusive pressed state, and All removes the filter', async () => {
  const { elements, calls } = await harness();
  const buttons = elements['topic-filters'].children;
  buttons[1].click();
  await flush();
  assert.equal(calls.at(-1).searchParams.get('topic'), item.topic);
  assert.equal(buttons[0].attributes['aria-pressed'], 'false');
  assert.equal(buttons[1].attributes['aria-pressed'], 'true');
  assert.equal(elements['highlights-status'].textContent, `1 highlight for ${item.topic}`);
  buttons[0].click();
  await flush();
  assert.equal(calls.at(-1).searchParams.has('topic'), false);
  assert.equal(calls.filter(url => url.pathname.endsWith('/topics')).length, 1);
});

test('honors configured API base paths', async () => {
  const { calls } = await harness({ base: 'https://content.example.test/v1/' });
  assert.equal(calls[0].href, 'https://content.example.test/v1/api/highlights');
});

test('reports API failure and retry recovers both topics and highlights', async () => {
  let failing = true;
  const { elements, errors } = await harness({
    fetcher: async url => {
      if (failing) throw new Error('Offline');
      return { ok: true, json: async () => url.pathname.endsWith('/topics')
        ? topicData : { count: 0, highlights: [] } };
    }
  });
  assert.match(elements['highlights-status'].textContent, /unavailable/);
  assert.equal(elements['highlights-retry'].hidden, false);
  assert.equal(elements['highlight-grid'].attributes['aria-busy'], 'false');
  assert.equal(errors.length, 1);
  failing = false;
  elements['highlights-retry'].click();
  await flush();
  assert.equal(elements['highlights-retry'].hidden, true);
  assert.match(elements['highlights-status'].textContent, /No highlights/);
  assert.equal(elements['topic-filters'].children.length, 3);
});

test('HTTP and malformed responses show failure rather than success-shaped defaults', async () => {
  for (const response of [
    { ok: false, status: 503 },
    { ok: true, json: async () => ({}) },
    { ok: true, json: async () => ({ ...topicData, count: 2, highlights: [item] }) }
  ]) {
    const { elements } = await harness({ fetcher: async () => response });
    assert.match(elements['highlights-status'].textContent, /unavailable/);
    assert.equal(elements['highlights-retry'].hidden, false);
  }
});

test('untrusted highlight strings remain literal text, never markup or links', async () => {
  const malicious = '<img src=x onerror=alert(1)>';
  const { elements } = await harness({
    fetcher: async url => ({ ok: true, json: async () => url.pathname.endsWith('/topics')
      ? topicData : { count: 1, highlights: [{ ...item, title: malicious, tryIt: 'javascript:alert(1)' }] } })
  });
  const card = elements['highlight-grid'].children[0];
  assert.equal(card.children[1].textContent, malicious);
  assert.equal(card.children[1].children.length, 0);
  assert.equal(card.children[3].children[1].textContent, 'javascript:alert(1)');
});

test('late responses cannot overwrite the newest selection', async () => {
  let resolveSlow;
  const { elements } = await harness({
    fetcher: async url => {
      if (url.pathname.endsWith('/topics')) return { ok: true, json: async () => topicData };
      if (url.searchParams.get('topic') === item.topic) {
        return new Promise(resolve => { resolveSlow = resolve; });
      }
      return { ok: true, json: async () => ({ count: 0, highlights: [] }) };
    }
  });
  const buttons = elements['topic-filters'].children;
  buttons[1].click();
  buttons[2].click();
  await flush();
  resolveSlow({ ok: true, json: async () => ({ count: 1, highlights: [item] }) });
  await flush();
  assert.match(elements['highlights-status'].textContent, /No highlights for Open source maintainers/);
  assert.equal(elements['highlight-grid'].children.length, 0);
});
