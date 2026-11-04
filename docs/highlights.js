(() => {
  const section = document.getElementById('keynote-highlights');
  const filters = document.getElementById('topic-filters');
  const grid = document.getElementById('highlight-grid');
  const status = document.getElementById('highlights-status');
  const retry = document.getElementById('highlights-retry');
  let selectedTopic = '';
  let topicsLoaded = false;
  let activeRequest;

  function textElement(tag, className, text) {
    const element = document.createElement(tag);
    element.className = className;
    element.textContent = text;
    return element;
  }

  async function getJSON(path, signal, topic = '') {
    const base = section.dataset.apiBase || 'http://localhost:3001';
    const url = new URL(path, `${base.replace(/\/+$/, '')}/`);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Invalid API URL');
    if (topic) url.searchParams.set('topic', topic);
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error(`API returned ${response.status}`);
    return response.json();
  }

  function renderTopics(data) {
    if (!Array.isArray(data.topics) || !data.topics.every(topic =>
      typeof topic.name === 'string' && topic.name.trim() &&
      typeof topic.slug === 'string' && Number.isInteger(topic.count) && topic.count >= 0
    )) throw new Error('Invalid topics response');
    const buttons = ['', ...data.topics.map(topic => topic.name)].map(topic => {
      const button = textElement('button', 'topic-filter', topic || 'All');
      button.type = 'button';
      button.setAttribute('aria-pressed', String(topic === selectedTopic));
      button.addEventListener('click', () => {
        selectedTopic = topic;
        buttons.forEach(item => item.setAttribute('aria-pressed', String(item === button)));
        loadHighlights();
      });
      return button;
    });
    filters.replaceChildren(...buttons);
    topicsLoaded = true;
  }

  function renderHighlights(data) {
    if (!Array.isArray(data.highlights) || data.count !== data.highlights.length ||
      !data.highlights.every(item => ['id', 'topic', 'title', 'summary', 'tryIt']
        .every(field => typeof item[field] === 'string'))) throw new Error('Invalid highlights response');
    const cards = data.highlights.map(item => {
      const card = document.createElement('li');
      card.className = 'highlight-card';
      const tryIt = textElement('p', 'highlight-try', '');
      tryIt.append(textElement('strong', '', 'Try it: '), document.createTextNode(item.tryIt));
      card.append(
        textElement('p', 'highlight-topic', item.topic),
        textElement('h3', '', item.title),
        textElement('p', 'highlight-summary', item.summary),
        tryIt
      );
      return card;
    });
    grid.replaceChildren(...cards);
    const scope = selectedTopic ? ` for ${selectedTopic}` : '';
    status.textContent = data.count
      ? `${data.count} ${data.count === 1 ? 'highlight' : 'highlights'}${scope}`
      : `No highlights${scope}. Try another topic.`;
  }

  async function loadHighlights() {
    activeRequest?.abort();
    const request = new AbortController();
    activeRequest = request;
    const timeout = setTimeout(() => request.abort(), 8000);
    grid.setAttribute('aria-busy', 'true');
    grid.replaceChildren();
    status.textContent = 'Loading highlights...';
    retry.hidden = true;
    try {
      const [highlights, topics] = await Promise.all([
        getJSON('api/highlights', request.signal, selectedTopic),
        topicsLoaded ? null : getJSON('api/topics', request.signal)
      ]);
      if (request !== activeRequest) return;
      if (topics) renderTopics(topics);
      renderHighlights(highlights);
    } catch (error) {
      if (request !== activeRequest) return;
      console.error('Unable to load keynote highlights:', error);
      status.textContent = 'Highlights are unavailable. Try again or explore the keynote recap below.';
      retry.hidden = false;
    } finally {
      clearTimeout(timeout);
      if (request === activeRequest) grid.setAttribute('aria-busy', 'false');
    }
  }

  retry.addEventListener('click', loadHighlights);
  loadHighlights();
})();
