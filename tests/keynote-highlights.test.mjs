import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const html = await readFile(new URL("../docs/index.html", import.meta.url), "utf8");
const script = html.slice(html.indexOf("const highlightsSection ="), html.lastIndexOf("</script>"));

const topics = [
    { name: "The modern GitHub experience", slug: "the-modern-github-experience", count: 3 },
    { name: "Open source maintainers", slug: "open-source-maintainers", count: 1 },
    { name: "Agentic software development", slug: "agentic-software-development", count: 2 },
];
const highlights = [0, 0, 0, 1, 2, 2].map((topic, i) => ({
    id: `h${i}`, topic: topics[topic].name, title: `Title ${i}`, summary: `<b>Summary ${i}</b>`, tryIt: `Try ${i}`,
}));

class FakeElement {
    constructor(tag) {
        Object.assign(this, { tag, children: [], attributes: {}, dataset: {}, listeners: {}, hidden: false, _text: "" });
        const classes = new Set();
        this.classList = { toggle: (name, on) => (on ? classes.add(name) : classes.delete(name)), contains: name => classes.has(name) };
    }
    set textContent(value) { this._text = String(value); this.children = []; }
    get textContent() { return this._text + this.children.map(child => child.textContent).join(""); }
    set innerHTML(_) { throw new Error("innerHTML must not be used"); }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    getAttribute(name) { return this.attributes[name] ?? null; }
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren(...nodes) { this.children = nodes; this._text = ""; }
    addEventListener(type, fn) { this.listeners[type] = fn; }
    click() { this.listeners.click?.(); }
    focus() { document.activeElement = this; }
    querySelectorAll(tag) {
        const found = [];
        const walk = node => node.children?.forEach(child => { if (child.tag === tag) found.push(child); walk(child); });
        walk(this);
        return found;
    }
}
let document;

function setup(api) {
    const ids = ["keynote-highlights", "highlight-filters", "highlight-count", "highlight-grid", "highlight-retry"];
    const elements = Object.fromEntries(ids.map(id => [id, new FakeElement(id === "highlight-retry" ? "button" : "div")]));
    elements["keynote-highlights"].dataset.apiBase = "http://api.test/";
    elements["highlight-retry"].hidden = true;
    document = {
        activeElement: null,
        getElementById: id => elements[id],
        createElement: tag => new FakeElement(tag),
        createTextNode: text => ({ textContent: text }),
    };
    const fetch = async url => {
        const { pathname, searchParams } = new URL(url);
        if (!api.up) throw new TypeError("Failed to fetch");
        if (pathname === "/api/topics") {
            if (api.topicsDown) throw new TypeError("Failed to fetch");
            return { ok: true, json: async () => ({ topics }) };
        }
        const topic = searchParams.get("topic");
        const list = topic ? highlights.filter(h => h.topic.toLowerCase() === topic.toLowerCase()) : highlights;
        return { ok: true, json: async () => ({ event: "Universe", count: list.length, highlights: list }) };
    };
    vm.runInNewContext(script, { document, fetch, URL, console: { error() {} } });
    const filters = () => elements["highlight-filters"].querySelectorAll("button");
    return {
        filters,
        pressed: () => filters().filter(b => b.getAttribute("aria-pressed") === "true").map(b => b.textContent),
        cards: () => elements["highlight-grid"].children,
        status: () => elements["highlight-count"].textContent,
        retry: elements["highlight-retry"],
    };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test("loads topics and highlights, filters with aria-pressed, renders text only", async () => {
    const ui = setup({ up: true });
    await settle();
    assert.deepEqual(ui.filters().map(b => b.textContent), ["All", ...topics.map(t => t.name)]);
    assert.equal(ui.cards().length, 6);
    assert.equal(ui.status(), "6 highlights");
    assert.equal(ui.retry.hidden, true);
    assert.match(ui.cards()[0].textContent, /<b>Summary 0<\/b>/);

    ui.filters()[3].click();
    await settle();
    assert.deepEqual(ui.pressed(), ["Agentic software development"]);
    assert.equal(ui.cards().length, 2);
});

test("full outage shows an error and accessible retry", async () => {
    const ui = setup({ up: false });
    await settle();
    assert.deepEqual(ui.filters().map(b => b.textContent), ["All"]);
    assert.equal(ui.cards().length, 0);
    assert.match(ui.status(), /Keynote highlights are unavailable/);
    assert.equal(ui.retry.hidden, false);
    assert.match(html, /<button type="button" class="highlight-retry" id="highlight-retry" hidden>Retry loading highlights<\/button>/);
});

for (const trigger of ["retry", "All"]) {
    test(`after an initial topics failure, ${trigger} restores topics and highlights`, async () => {
        const api = { up: false };
        const ui = setup(api);
        await settle();
        api.up = true;
        (trigger === "retry" ? ui.retry : ui.filters()[0]).click();
        await settle();
        assert.equal(ui.filters().length, 4);
        assert.deepEqual(ui.pressed(), ["All"]);
        assert.equal(ui.cards().length, 6);
        assert.equal(ui.status(), "6 highlights");
        assert.equal(ui.retry.hidden, true);
    });
}

test("topics-only failure shows six cards, flags filters unavailable, then All recovers topics", async () => {
    const api = { up: true, topicsDown: true };
    const ui = setup(api);
    await settle();
    assert.deepEqual(ui.filters().map(b => b.textContent), ["All"]);
    assert.equal(ui.cards().length, 6);
    assert.match(ui.status(), /Topic filters are unavailable/);
    assert.equal(ui.retry.hidden, false);

    api.topicsDown = false;
    ui.filters()[0].click();
    await settle();
    assert.equal(ui.filters().length, 4);
    assert.deepEqual(ui.pressed(), ["All"]);
    assert.equal(ui.retry.hidden, true);
});
