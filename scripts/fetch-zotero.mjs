import { mkdir, readFile, writeFile } from 'node:fs/promises';

const groupId = 6675069;
const collectionKey = '46PVIB4L';
const apiBase = `https://api.zotero.org/groups/${groupId}/collections/${collectionKey}/items/top`;
const generatedAt = new Date().toISOString();

const escapeHtml = (value) => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

const slugify = (value) => String(value).toLowerCase().trim()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'paper';

const displayTag = (tag) => tag.replace(/^s2quare:/i, '').replace(/[-_]/g, ' ').trim()
  .replace(/\b\w/g, (letter) => letter.toUpperCase());

async function fetchAllItems() {
  const items = [];
  for (let start = 0; ; start += 100) {
    const response = await fetch(`${apiBase}?format=json&limit=100&start=${start}`);
    if (!response.ok) throw new Error(`Zotero API returned ${response.status}`);
    const batch = await response.json();
    items.push(...batch);
    if (batch.length < 100) return items;
  }
}

function normalize(item) {
  const data = item.data ?? {};
  const tags = (data.tags ?? []).map(({ tag }) => tag).filter(Boolean);
  const specialTags = new Set(['featured', 'must-read']);
  const topics = [...new Set(tags.filter((tag) => !specialTags.has(tag.toLowerCase())).map(displayTag))];
  const authors = (data.creators ?? []).map((creator) => [creator.firstName, creator.lastName].filter(Boolean).join(' ')).filter(Boolean);
  return {
    key: item.key,
    title: data.title || 'Untitled paper',
    authors,
    date: data.date || '',
    year: Number.parseInt(data.date ?? '', 10) || null,
    venue: data.publicationTitle || data.repository || data.itemType || '',
    doi: data.DOI || null,
    url: data.url || null,
    abstract: data.abstractNote || null,
    tags,
    topics,
    featured: tags.some((tag) => tag.toLowerCase() === 'featured' || tag.toLowerCase() === 'must-read'),
    zoteroUrl: `https://www.zotero.org/groups/${groupId}/items/${item.key}`,
  };
}

function groupedPapers(papers) {
  const groups = new Map();
  for (const paper of papers) {
    for (const topic of paper.topics.length ? paper.topics : ['Uncategorized']) {
      if (!groups.has(topic)) groups.set(topic, []);
      groups.get(topic).push(paper);
    }
  }
  return [...groups].sort(([a], [b]) => a.localeCompare(b));
}

function markdown(papers) {
  const lines = [
    '# awesome_s2quare', '',
    'An open, curated reading list for quantitative MRI and the S2quare project.', '',
    'This list is synchronized from the public [awesome_s2quare Zotero group](https://www.zotero.org/groups/awesome_s2quare).', '',
    '## Featured', '',
  ];
  const featured = papers.filter((paper) => paper.featured);
  lines.push(...(featured.length ? featured.map((paper) => paperLine(paper)) : ['_No featured papers yet._']), '', '## Topics', '');
  for (const [topic, topicPapers] of groupedPapers(papers)) {
    lines.push(`### ${topic}`, '', ...topicPapers.map((paper) => paperLine(paper)), '');
  }
  lines.push('## Data', '', 'The machine-readable list is available at [`data/papers.json`](data/papers.json) and the searchable static view is published in [`docs/`](docs/).', '', '## License', '', 'Paper metadata and generated content are licensed under [CC BY 4.0](LICENSE). The sync script is MIT licensed.', '');
  return lines.join('\n');
}

function paperLine(paper) {
  const link = paper.url || (paper.doi ? `https://doi.org/${paper.doi}` : paper.zoteroUrl);
  const authorText = paper.authors.length ? ` — ${paper.authors.join(', ')}` : '';
  const year = paper.year ? ` (${paper.year})` : '';
  return `- [${paper.title}](${link})${year}${authorText}`;
}

function html(papers) {
  const cards = groupedPapers(papers).map(([topic, topicPapers]) => `
    <section aria-labelledby="topic-${slugify(topic)}">
      <h2 id="topic-${slugify(topic)}">${escapeHtml(topic)}</h2>
      <div class="papers">${topicPapers.map((paper) => `
        <article class="paper" data-search="${escapeHtml([paper.title, ...paper.authors, paper.abstract, ...paper.tags].join(' '))}">
          <p class="meta">${escapeHtml(paper.venue)}${paper.year ? ` · ${paper.year}` : ''}</p>
          <h3><a href="${escapeHtml(paper.url || (paper.doi ? `https://doi.org/${paper.doi}` : paper.zoteroUrl))}">${escapeHtml(paper.title)}</a></h3>
          <p>${escapeHtml(paper.authors.join(', '))}</p>
          ${paper.abstract ? `<p>${escapeHtml(paper.abstract)}</p>` : ''}
          <div class="tags">${paper.tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join('')}</div>
        </article>`).join('')}</div>
    </section>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>awesome_s2quare</title><meta name="description" content="An open, curated reading list for quantitative MRI and the S2quare project."><link rel="stylesheet" href="style.css"></head><body><main><p class="eyebrow">OPEN READING LIST</p><h1>awesome_s2quare</h1><p>An open, curated reading list for quantitative MRI and the S2quare project.</p><label for="search">Search papers</label><input id="search" type="search" placeholder="Title, author, topic..."><p id="result-count" aria-live="polite">${papers.length} papers</p>${papers.length ? cards : '<p class="empty">No papers have been added yet. Add papers to the <code>paper</code> Zotero collection.</p>'}</main><script>const input=document.querySelector('#search');const cards=[...document.querySelectorAll('.paper')];const count=document.querySelector('#result-count');input?.addEventListener('input',()=>{const query=input.value.toLowerCase();let visible=0;cards.forEach(card=>{const match=card.dataset.search.toLowerCase().includes(query);card.hidden=!match;if(match)visible++});count.textContent=visible+' papers';});</script></body></html>`;
}

const papers = (await fetchAllItems()).map(normalize).sort((a, b) => (b.year ?? 0) - (a.year ?? 0) || a.title.localeCompare(b.title));
const payload = { generatedAt, source: { groupId, collectionKey, collectionName: 'paper' }, papers };
await mkdir('data', { recursive: true });
await mkdir('docs', { recursive: true });
await writeFile('data/papers.json', `${JSON.stringify(payload, null, 2)}\n`);
await writeFile('README.md', markdown(papers));
await writeFile('docs/index.html', html(papers));
await writeFile('docs/style.css', `:root{color-scheme:light dark;font-family:system-ui,sans-serif;line-height:1.6}body{margin:0;background:#f7f7f5;color:#202124}main{max-width:58rem;margin:0 auto;padding:8vh 1.5rem}h1{font-size:clamp(2.5rem,8vw,5rem);line-height:1;margin:0 0 1rem}.eyebrow{color:#b45309;font:700 .75rem/1 monospace;letter-spacing:.16em}label{display:block;font-weight:600;margin-top:2rem}input{box-sizing:border-box;width:100%;font:inherit;padding:.75rem;border:1px solid #aaa;border-radius:.4rem;margin:.5rem 0 2rem}.paper{background:#fff;border:1px solid #ddd;border-radius:.6rem;padding:1.25rem;margin:1rem 0}.paper[hidden]{display:none}.paper h3{margin:.25rem 0}.paper h3 a{color:inherit}.meta{font: .85rem ui-monospace,monospace;color:#666}.tags{display:flex;flex-wrap:wrap;gap:.4rem}.tags span{font-size:.8rem;background:#eee;border-radius:99px;padding:.15rem .55rem}.empty{margin-top:3rem;padding:1rem;border-left:3px solid #b45309;background:#fff}@media(prefers-color-scheme:dark){body{background:#111;color:#eee}.paper,.empty{background:#1d1d1d}.tags span{background:#333}.meta{color:#aaa}}`);
console.log(`Synchronized ${papers.length} papers from Zotero.`);
