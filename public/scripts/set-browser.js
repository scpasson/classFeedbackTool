// Shared by /questionSets, /discover and /bookmarks. The page's #setBrowser element carries data-mode.
const MODE = document.getElementById('setBrowser').dataset.mode;
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const LETTERS = ['A', 'B', 'C', 'D'];

let sets = [];
const open = new Set();
const questionCache = {};
let searchTimer;

const sorter = createSort('sets', { key: 'modified', dir: -1 }, render);
const getters = {
    title: s => s.title,
    subject: s => s.subject,
    owner: s => s.ownerName,
    count: s => s.questions.length,
    tags: s => (s.tags || []).join(', '),
    modified: s => new Date(s.modifiedAt).getTime(),
    saved: s => (s.bookmarked ? 1 : 0),
    visibility: s => (s.isPublic ? 'Public' : 'Private')
};

const COLUMNS = {
    mine: [['title', 'Title'], ['subject', 'Subject'], ['count', 'Questions'], ['tags', 'Tags'], ['visibility', 'Visibility'], ['modified', 'Modified']],
    discover: [['title', 'Title'], ['subject', 'Subject'], ['owner', 'Owner'], ['count', 'Questions'], ['tags', 'Tags'], ['modified', 'Modified'], ['saved', 'Bookmarked']],
    bookmarks: [['title', 'Title'], ['subject', 'Subject'], ['owner', 'Owner'], ['count', 'Questions'], ['tags', 'Tags'], ['modified', 'Modified'], ['saved', 'Bookmarked']]
}[MODE];

async function api(url, method = 'GET', body) {
    const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
}

async function load() {
    const q = $('searchQ') ? $('searchQ').value : '';
    const url = { mine: '/api/question-sets', bookmarks: '/api/question-sets/bookmarks', discover: `/api/question-sets/discover?${new URLSearchParams({ q })}` }[MODE];
    sets = await api(url);
    render();
}

function debouncedLoad() {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(load, 250);
}

function render() {
    const box = $('setTable');
    if (!sets.length) {
        box.innerHTML = `<p class="text-xs text-app-muted">${{ mine: 'You have no question sets yet. Create one above.', discover: 'No public question sets found.', bookmarks: 'No bookmarked sets yet. Use Discover to find some.' }[MODE]}</p>`;
        return;
    }
    const th = 'pb-2 pr-3';
    const head = `<tr class="border-b border-app-border text-app-muted text-xs text-left">
        ${COLUMNS.map(([key, label]) => sorter.th(key, label, th)).join('')}<th class="${th}">Actions</th></tr>`;
    const cells = {
        title: s => `<td class="py-2 pr-3 font-semibold"><a href="/questionSet/${s._id}" class="hover:underline text-app-accent">${esc(s.title)}</a>${s.isPublic ? '' : ' <span class="text-xs text-app-muted">(private)</span>'}</td>`,
        subject: s => `<td class="py-2 pr-3">${esc(s.subject)}</td>`,
        owner: s => `<td class="py-2 pr-3">${s.mine ? 'You' : esc(s.ownerName)}</td>`,
        count: s => `<td class="py-2 pr-3 font-mono">${s.questions.length}</td>`,
        tags: s => `<td class="py-2 pr-3 text-xs text-app-muted">${(s.tags || []).map(t => '#' + esc(t)).join(' ')}</td>`,
        modified: s => `<td class="py-2 pr-3 whitespace-nowrap">${new Date(s.modifiedAt).toLocaleString()}</td>`,
        saved: s => `<td class="py-2 pr-3">${s.bookmarked ? 'Yes' : 'No'}</td>`,
        visibility: s => `<td class="py-2 pr-3">${s.isPublic ? 'Public' : 'Private'}</td>`
    };
    const rows = sorter.apply(sets, getters).map(s => {
        const btn = 'px-2 py-1 bg-app-sec hover:bg-app-sec-hover rounded text-xs';
        const actions = [
            `<button onclick="togglePreview('${s._id}')" class="${btn}">${open.has(s._id) ? 'Hide' : 'Preview'}</button>`,
            s.mine
                ? `<a href="/questionSet/${s._id}" class="${btn}">Edit</a>`
                : `<button onclick="toggleBookmark('${s._id}')" class="${btn}">${s.bookmarked ? 'Unbookmark' : 'Bookmark'}</button>`,
            `<button onclick="cloneSet('${s._id}')" class="${btn}">Clone</button>`,
            `<button onclick="copyLink('${s._id}', this)" class="${btn}">Copy link</button>`,
            s.mine ? `<button onclick="deleteSet('${s._id}')" class="px-2 py-1 bg-app-danger hover:bg-app-danger-hover rounded text-xs">Delete</button>` : ''
        ].join(' ');
        const preview = open.has(s._id)
            ? `<tr class="border-b border-app-border"><td colspan="${COLUMNS.length + 1}" class="p-3 bg-app-body">${previewHtml(s._id)}</td></tr>` : '';
        return `<tr class="border-b border-app-border">${COLUMNS.map(([key]) => cells[key](s)).join('')}
            <td class="py-2 whitespace-nowrap">${actions}</td></tr>${preview}`;
    }).join('');
    box.innerHTML = `<table class="w-full text-sm text-left"><thead>${head}</thead><tbody>${rows}</tbody></table>`;
    renderMath();
}

function previewHtml(id) {
    const qs = questionCache[id];
    if (!qs) return '<span class="text-xs text-app-muted">Loading...</span>';
    if (!qs.length) return '<span class="text-xs text-app-muted">No questions in this set.</span>';
    return qs.map((q, i) => `<div class="mb-3 text-sm">
        <div><span class="font-bold text-app-accent">Q${i + 1}.</span> <span class="math-render">${esc(q.prompt)}</span></div>
        <div class="grid grid-cols-2 gap-x-4 text-xs text-app-muted mt-1">
            ${(q.options || []).map((o, k) => `<span class="${q.questionType !== 'poll' && k === q.correctAnswerIndex ? 'text-app-accent' : ''}">${LETTERS[k]}. <span class="math-render rich-small">${esc(o)}</span></span>`).join('')}
        </div></div>`).join('');
}

async function togglePreview(id) {
    if (open.has(id)) { open.delete(id); return render(); }
    open.add(id);
    render();
    try {
        questionCache[id] = await api(`/api/question-sets/${id}/questions`);
    } catch (e) { questionCache[id] = []; alert(e.message); }
    render();
}

async function toggleBookmark(id) {
    const s = sets.find(x => x._id === id);
    try {
        await api(`/api/question-sets/${id}/bookmark`, s.bookmarked ? 'DELETE' : 'PUT');
        await load();
    } catch (e) { alert(e.message); }
}

async function cloneSet(id) {
    try {
        const copy = await api(`/api/question-sets/${id}/clone`, 'POST');
        location.href = `/questionSet/${copy._id}`;
    } catch (e) { alert(e.message); }
}

async function copyLink(id, btn) {
    try {
        await navigator.clipboard.writeText(`${location.origin}/questionSet/${id}`);
        btn.textContent = 'Copied';
    } catch { prompt('Copy this link:', `${location.origin}/questionSet/${id}`); }
}

async function deleteSet(id) {
    if (!confirm('Delete this set? Its questions stay in the question bank.')) return;
    try {
        await api(`/api/question-sets/${id}`, 'DELETE');
        await load();
    } catch (e) { alert(e.message); }
}

async function createSet() {
    const body = { title: $('newTitle').value.trim(), subject: $('newSubject').value.trim() };
    if (!body.title || !body.subject) return alert('Title and subject are required.');
    try {
        const created = await api('/api/question-sets', 'POST', body);
        location.href = `/questionSet/${created._id}`;
    } catch (e) { alert(e.message); }
}

load();
