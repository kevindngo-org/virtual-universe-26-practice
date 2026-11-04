(() => {
  const section = document.getElementById('keynote-highlights');
  const filters = document.getElementById('topic-filters');
  const grid = document.getElementById('highlight-grid');
  const status = document.getElementById('highlights-status');
  const retry = document.getElementById('highlights-retry');
  let selectedTopic = '';
  let topicsReady = false;
  let request;

  function element(tag, className, text) {
    const node = document.createElement(tag);
    node.className = className;
    node.textContent = text;
    return node;
  }

  function validateTopics(data) {
    if (!data || !Array.isArray(data.topics) || !data.topics.every(topic =>
      topic && typeof topic.name === 'string' && topic.name.trim() &&
      typeof topic.slug === 'string' && Number.isInteger(topic.count) && topic.count >= 0
    ) || new Set(data.topics.map(topic => topic.name)).size !== data.topics.length) {
      throw new Error('Invalid topics response');
    }
    return data.topics;
  }

  function validateHighlights(data) {
    if (!data || typeof data.event !== 'string' ||
      !Array.isArray(data.highlights) || data.count !== data.highlights.length ||
      !data.highlights.every(item => item &&
        ['id', 'topic', 'title', 'summary', 'tryIt'].every(key => typeof item[key] === 'string'))) {
      throw new Error('Invalid highlights response');
    }
    return data;
  }

  async function fetchData(path, signal) {
    const base = section.dataset.apiBase || 'http://localhost:3001';
    const url = new URL(`${base.replace(/\/+$/, '')}/${path}`);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Invalid API URL');
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error(`Highlights API returned ${response.status}`);
    return response.json();
  }

  function renderHighlights(data) {
    const cards = data.highlights.map(item => {
      const card = element('article', 'highlight-card', '');
      card.append(
        element('p', 'highlight-topic', item.topic),
        element('h3', '', item.title),
        element('p', 'highlight-summary', item.summary)
      );
      const suggestion = element('p', 'highlight-try', '');
      suggestion.append(element('strong', '', 'Try it: '), document.createTextNode(item.tryIt));
      card.append(suggestion);
      const listItem = document.createElement('li');
      listItem.append(card);
      return listItem;
    });
    grid.replaceChildren(...cards);
    const topicLabel = selectedTopic ? ` for ${selectedTopic}` : '';
    status.textContent = data.count === 0
      ? `0 highlights${topicLabel}. Try another topic.`
      : `${data.count} ${data.count === 1 ? 'highlight' : 'highlights'}${topicLabel}`;
  }

  async function load(topic = selectedTopic) {
    request?.abort();
    const controller = new AbortController();
    request = controller;
    const timeout = setTimeout(() => controller.abort(), 10000);
    selectedTopic = topic;
    for (const button of filters.querySelectorAll('button')) {
      button.setAttribute('aria-pressed', String(button.dataset.topic === topic));
    }
    grid.replaceChildren();
    grid.setAttribute('aria-busy', 'true');
    status.textContent = 'Loading highlights...';
    retry.hidden = true;
    try {
      const highlightsPath = topic
        ? `api/highlights?${new URLSearchParams({ topic })}`
        : 'api/highlights';
      const [data, topics] = await Promise.all([
        fetchData(highlightsPath, controller.signal).then(validateHighlights),
        topicsReady ? null : fetchData('api/topics', controller.signal).then(validateTopics)
      ]);
      if (request !== controller) return;
      if (topics) {
        for (const topic of topics) {
          const button = element('button', 'topic-filter', topic.name);
          button.type = 'button';
          button.dataset.topic = topic.name;
          button.setAttribute('aria-pressed', 'false');
          filters.append(button);
        }
        topicsReady = true;
      }
      renderHighlights(data);
    } catch (error) {
      if (request !== controller) return;
      controller.abort();
      console.error('Unable to load keynote highlights:', error);
      status.textContent = 'Highlights are unavailable. Retry or explore the keynote recap below.';
      retry.hidden = false;
    } finally {
      clearTimeout(timeout);
      if (request === controller) grid.setAttribute('aria-busy', 'false');
    }
  }

  filters.addEventListener('click', event => {
    const button = event.target.closest('button[data-topic]');
    if (button && filters.contains(button)) load(button.dataset.topic);
  });
  retry.addEventListener('click', () => load());
  load();
})();
