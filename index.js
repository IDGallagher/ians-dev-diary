/* /index.js  –  front-page logic
   Fetch posts.json, build a card for each post and append it to #card-grid.
   Change PAGE_SIZE if you want fewer/more cards at first load.            */

const PAGE_SIZE = 9;   // number of cards to show initially
let page = 0, posts = [];

(async () => {
  posts = await fetch("/posts.json").then(r => r.json());
  if (!Array.isArray(posts)) {
    console.error("posts.json is not an array"); return;
  }
  renderPage();
  const search = document.querySelector('.search-bar input[type="search"]');
  if (search) {
    search.addEventListener('input', handleSearch);
    if (search.value) search.dispatchEvent(new Event('input'));
  }
})();

function renderPage() {
  const slice = posts.slice(page * PAGE_SIZE, ++page * PAGE_SIZE);
  const grid  = document.getElementById("card-grid");
  slice.forEach(p => grid.append(makeCard(p)));
}

function handleSearch(e) {
  const query = e.target.value.trim().toLowerCase();
  const grid = document.getElementById('card-grid');
  grid.innerHTML = '';
  if (query) {
    const filtered = posts.filter(p =>
      (p.title && p.title.toLowerCase().includes(query)) ||
      (p.subtitle && p.subtitle.toLowerCase().includes(query)) ||
      (Array.isArray(p.tags) && p.tags.join(' ').toLowerCase().includes(query))
    );
    filtered.forEach(p => grid.append(makeCard(p)));
  } else {
    page = 0;
    renderPage();
  }
}

function makeCard({ slug, title, subtitle, cover, date, tags }) {
  const a = document.createElement("a");
  a.href  = `/posts/${slug}/`;
  a.className = "card";
  
  // Support both SVG and PNG images: try SVG first, fallback to PNG
  const imageSrc = cover ? cover : `/posts/${slug}/cover.svg`;
  const fallbackSrc = `/posts/${slug}/cover.png`;
  
  const tagsHtml = tags ? tags.map(tag => `<span class="tag">${tag}</span>`).join('') : '';
  a.innerHTML = `
      <img src="${imageSrc}" onerror="this.onerror=null; this.src='${fallbackSrc}';" alt="${title}">
      <div class="card-body">
        <p class="date">${new Date(date).toLocaleDateString()}</p>
        <h3>${title}</h3>
        <p>${subtitle}</p>
        <div class="tags-container">
          ${tagsHtml}
        </div>
      </div>`;
  return a;
}
