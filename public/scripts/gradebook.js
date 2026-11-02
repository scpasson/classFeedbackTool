const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const HIDDEN_KEY = 'gradebookHiddenSets';

let data = { sets: [], students: [] };

async function api(url) {
    const res = await fetch(url);
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'Request failed');
    return body;
}

// Hidden sets are remembered per class in this browser.
const hiddenStore = () => { try { return JSON.parse(localStorage.getItem(HIDDEN_KEY)) || {}; } catch { return {}; } };
const hiddenSets = () => new Set(hiddenStore()[$('classSelect').value] || []);
function saveHidden(set) {
    const store = hiddenStore();
    store[$('classSelect').value] = [...set];
    localStorage.setItem(HIDDEN_KEY, JSON.stringify(store));
}

const visibleSets = () => data.sets.filter(s => !hiddenSets().has(s._id));
const fmtDate = d => new Date(d).toLocaleDateString();

function hideSet(id) {
    const h = hiddenSets();
    h.add(id);
    saveHidden(h);
    render();
}

function showAll() {
    saveHidden(new Set());
    render();
}

function clearDates() {
    $('from').value = '';
    $('to').value = '';
    load();
}

async function load() {
    const classId = $('classSelect').value;
    if (!classId) { data = { sets: [], students: [] }; return render(); }
    const params = new URLSearchParams();
    if ($('from').value) params.set('from', $('from').value);
    if ($('to').value) params.set('to', $('to').value);
    try {
        data = await api(`/api/classes/${classId}/gradebook?${params}`);
        render();
    } catch (e) { $('msg').textContent = e.message; }
}

const sorter = createSort('gradebook', { key: 'name', dir: 1 }, render);

function render() {
    const sets = visibleSets();
    const hiddenCount = data.sets.length - sets.length;
    $('msg').textContent = `${sets.length} set(s) shown${hiddenCount ? `, ${hiddenCount} hidden` : ''}.`;
    if (!sets.length) { $('table').innerHTML = ''; return; }

    const getters = { name: st => st.name };
    for (const s of sets) for (const f of ['total', 'answered', 'correct']) getters[`${s._id}:${f}`] = st => st.summaries[s._id][f];

    const th = 'px-2 py-1 text-xs text-app-muted font-semibold text-center';
    const head1 = `<tr class="border-b border-app-border">
        ${sorter.th('name', 'Student', `${th} text-left align-bottom`, 'rowspan="2"')}
        ${sets.map(s => `<th colspan="3" class="${th} border-l border-app-border">
            ${esc(s.title)}<br><span class="font-normal text-app-muted">${fmtDate(s.firstAt)}</span>
            <button onclick="hideSet('${s._id}')" class="ml-1 text-[10px] text-app-muted hover:text-app-error-border underline">Hide</button></th>`).join('')}</tr>`;
    const head2 = `<tr class="border-b border-app-border">${sets.map(s =>
        [['total', 'Questions'], ['answered', 'Answered'], ['correct', 'Correct']].map(([f, t], i) => sorter.th(`${s._id}:${f}`, t, `${th} ${i === 0 ? 'border-l border-app-border' : ''}`)).join('')).join('')}</tr>`;
    const rows = sorter.apply(data.students, getters).map(st => `<tr class="border-b border-app-border">
        <td class="px-2 py-1.5 whitespace-nowrap">${esc(st.name)}</td>
        ${sets.map(s => {
            const x = st.summaries[s._id];
            return `<td class="px-2 py-1.5 text-center font-mono border-l border-app-border">${x.total}</td>
                <td class="px-2 py-1.5 text-center font-mono">${x.answered}</td>
                <td class="px-2 py-1.5 text-center font-mono text-app-accent">${x.correct}</td>`;
        }).join('')}</tr>`).join('');
    $('table').innerHTML = `<thead>${head1}${head2}</thead><tbody>${rows}</tbody>`;
}

// Tab-separated so it pastes straight into a spreadsheet or gradebook.
async function copyTable() {
    const sets = visibleSets();
    if (!sets.length) return;
    const header1 = ['Student', ...sets.flatMap(s => [s.title, '', ''])];
    const header2 = ['', ...sets.flatMap(() => ['Questions', 'Answered', 'Correct'])];
    const rows = data.students.map(st => [st.name, ...sets.flatMap(s => {
        const x = st.summaries[s._id];
        return [x.total, x.answered, x.correct];
    })]);
    const text = [header1, header2, ...rows].map(r => r.join('\t')).join('\n');
    try {
        await navigator.clipboard.writeText(text);
        $('msg').textContent = 'Copied to clipboard.';
    } catch {
        $('msg').textContent = 'Copy failed; clipboard access needs HTTPS or localhost.';
    }
}

(async () => {
    const classes = await api('/api/classes');
    $('classSelect').innerHTML = classes.map(c => `<option value="${c._id}">${esc(c.name)}</option>`).join('');
    load();
})();
