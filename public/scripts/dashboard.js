let classes = [];
let questionSets = [];

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const cell = 'bg-app-body border border-app-border p-1.5 rounded text-xs w-full';
const currentClassId = () => document.getElementById('classSelect').value;

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

function say(text, ok) {
    const el = document.getElementById('rosterMsg');
    el.className = `text-xs ${ok ? 'text-app-accent' : 'text-app-error-border'}`;
    el.textContent = text;
}

// ---------- Classes ----------
async function loadClasses(selectId) {
    classes = await api('/api/classes');
    const sel = document.getElementById('classSelect');
    sel.innerHTML = '<option value="" disabled selected>Select a class...</option>' +
        classes.map(c => `<option value="${c._id}">${esc(c.name)}</option>`).join('');
    if (selectId) sel.value = selectId;
    onClassChange();
}

function onClassChange() {
    const cls = classes.find(c => c._id === currentClassId());
    document.getElementById('className').value = cls ? cls.name : '';
    document.getElementById('classYear').value = cls ? cls.academicYear : '';
    loadStudents();
}

function newClassForm() {
    document.getElementById('classSelect').value = '';
    document.getElementById('className').value = '';
    document.getElementById('classYear').value = '';
    document.getElementById('studentTableBody').innerHTML = '';
    students = [];
    document.getElementById('className').focus();
}

async function saveClass() {
    const body = {
        name: document.getElementById('className').value.trim(),
        academicYear: document.getElementById('classYear').value.trim()
    };
    if (!body.name || !body.academicYear) return alert('Class name and academic year are required.');
    try {
        const id = currentClassId();
        const saved = id ? await api(`/api/classes/${id}`, 'PUT', body) : await api('/api/classes', 'POST', body);
        await loadClasses(saved._id);
    } catch (e) { alert(e.message); }
}

async function deleteClass() {
    const id = currentClassId();
    if (!id || !confirm('Delete this class, its students and their responses?')) return;
    await api(`/api/classes/${id}`, 'DELETE');
    await loadClasses();
}

// ---------- Roster ----------
let students = [];
let sortKey = 'sortOrder';
let sortDir = 1;
const NUMERIC_COLS = ['sortOrder', 'cardId'];

async function loadStudents() {
    const id = currentClassId();
    students = id ? await api(`/api/classes/${id}/students`) : [];
    renderStudents();
}

// Keep unsaved edits when the table is re-sorted.
function syncFromDom() {
    document.querySelectorAll('#studentTableBody tr').forEach(tr => {
        const s = students.find(x => x._id === tr.dataset.id);
        if (!s) return;
        s.firstName = tr.querySelector('.s-first').value;
        s.lastName = tr.querySelector('.s-last').value;
        s.presentedName = tr.querySelector('.s-presented').value;
        s.studentNumber = tr.querySelector('.s-number').value;
        s.sortOrder = tr.querySelector('.s-sort').value;
        s.cardId = tr.querySelector('.s-card').value;
    });
}

function compareStudents(a, b) {
    const av = a[sortKey], bv = b[sortKey];
    const aEmpty = av === null || av === undefined || av === '';
    const bEmpty = bv === null || bv === undefined || bv === '';
    if (aEmpty || bEmpty) return aEmpty === bEmpty ? 0 : (aEmpty ? 1 : -1); // blanks always last
    const r = NUMERIC_COLS.includes(sortKey)
        ? Number(av) - Number(bv)
        : String(av).localeCompare(String(bv), undefined, { sensitivity: 'base', numeric: true });
    return r * sortDir;
}

function setSort(key) {
    syncFromDom();
    if (sortKey === key) sortDir = -sortDir;
    else { sortKey = key; sortDir = 1; }
    renderStudents();
}

function renderStudents() {
    ['firstName', 'lastName', 'presentedName', 'studentNumber', 'sortOrder', 'cardId'].forEach(k => {
        document.getElementById(`sort-${k}`).textContent = k === sortKey ? (sortDir === 1 ? '\u25B2' : '\u25BC') : '';
    });
    document.getElementById('studentTableBody').innerHTML = [...students].sort(compareStudents).map(s => `
        <tr class="border-b bg-app-border/50" data-id="${s._id}">
            <td class="py-1.5 pr-2"><input class="${cell} s-first" value="${esc(s.firstName)}"></td>
            <td class="py-1.5 pr-2"><input class="${cell} s-last" value="${esc(s.lastName)}"></td>
            <td class="py-1.5 pr-2"><input class="${cell} s-presented" value="${esc(s.presentedName)}"></td>
            <td class="py-1.5 pr-2"><input class="${cell} s-number" value="${esc(s.studentNumber)}"></td>
            <td class="py-1.5 pr-2"><input class="${cell} s-sort font-mono !w-20" value="${esc(s.sortOrder)}"></td>
            <td class="py-1.5 pr-2"><input class="${cell} s-card font-mono text-app-accent !w-20" value="${esc(s.cardId)}"></td>
            <td class="py-1.5 whitespace-nowrap">
                <button onclick="saveStudent('${s._id}', this)" class="bg-app-sec hover:bg-app-sec-hover text-xs px-3 py-1.5 rounded">Save</button>
                <button onclick="deleteStudent('${s._id}')" class="bg-app-danger hover:bg-app-danger-hover text-xs px-3 py-1.5 rounded">Delete</button>
            </td>
        </tr>`).join('');
}

async function addStudent() {
    const id = currentClassId();
    if (!id) return say('Save or select a class first.', false);
    const body = {
        firstName: document.getElementById('newFirst').value.trim(),
        lastName: document.getElementById('newLast').value.trim(),
        presentedName: document.getElementById('newPresented').value.trim(),
        studentNumber: document.getElementById('newNumber').value.trim(),
        sortOrder: document.getElementById('newSort').value.trim(),
        cardId: document.getElementById('newCard').value.trim()
    };
    try {
        await api(`/api/classes/${id}/students`, 'POST', body);
        ['newFirst', 'newLast', 'newPresented', 'newNumber', 'newSort', 'newCard'].forEach(f => document.getElementById(f).value = '');
        say('Student added.', true);
        loadStudents();
    } catch (e) { say(e.message, false); }
}

async function addBulk() {
    const id = currentClassId();
    if (!id) return say('Save or select a class first.', false);
    const box = document.getElementById('bulkText');
    const lines = box.value.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const failed = [];
    let added = 0;
    for (const line of lines) {
        const [firstName = '', lastName = '', presentedName = '', studentNumber = '', sortOrder = '', cardId = ''] = line.split(/\t|,/).map(p => p.trim());
        try {
            await api(`/api/classes/${id}/students`, 'POST', { firstName, lastName, presentedName, studentNumber, sortOrder, cardId });
            added++;
        } catch (e) { failed.push(`${line} (${e.message})`); }
    }
    box.value = failed.map(f => f.replace(/ \([^)]*\)$/, '')).join('\n');
    say(`Added ${added}.${failed.length ? ' Failed: ' + failed.join('; ') : ''}`, !failed.length);
    loadStudents();
}

async function saveStudent(id, btn) {
    const tr = btn.closest('tr');
    const body = {
        firstName: tr.querySelector('.s-first').value.trim(),
        lastName: tr.querySelector('.s-last').value.trim(),
        presentedName: tr.querySelector('.s-presented').value.trim(),
        studentNumber: tr.querySelector('.s-number').value.trim(),
        sortOrder: tr.querySelector('.s-sort').value.trim(),
        cardId: tr.querySelector('.s-card').value.trim()
    };
    try {
        const saved = await api(`/api/students/${id}`, 'PUT', body);
        const i = students.findIndex(s => s._id === id);
        if (i >= 0) students[i] = saved;
        say(`Saved ${saved.name}.`, true);
    } catch (e) { say(e.message, false); }
}

async function deleteStudent(id) {
    if (!confirm('Remove this student and their responses?')) return;
    await api(`/api/students/${id}`, 'DELETE');
    loadStudents();
}

// ---------- Question sets ----------
const setSorter = createSort('dashSets', { key: 'name', dir: 1 }, renderSets);
const setGetters = {
    name: s => s.title,
    subject: s => s.subject,
    count: s => s.questions?.length ?? 0,
    status: s => (s.active !== false ? 'Active' : 'Inactive'),
    visibility: s => (s.isPublic ? 'Public' : 'Private'),
    modified: s => new Date(s.modifiedAt).getTime()
};

async function loadSets() {
    questionSets = await api('/api/question-sets');
    renderSets();
}

function renderSets() {
    const box = document.getElementById('setList');
    if (!questionSets.length) {
        box.innerHTML = '<p class="text-xs text-app-muted">No question sets yet.</p>';
        return;
    }
    const th = 'pb-2 pr-3';
    const head = `<tr class="border-b border-app-border text-app-muted text-xs text-left">
        ${setSorter.th('name', 'Name', th)}${setSorter.th('subject', 'Subject', th)}${setSorter.th('count', 'Questions', th)}
        ${setSorter.th('status', 'Status', th)}${setSorter.th('visibility', 'Visibility', th)}${setSorter.th('modified', 'Last modified', th)}
        <th class="${th}">Actions</th></tr>`;
    const rows = setSorter.apply(questionSets, setGetters).map(s => {
        const active = s.active !== false;
        return `<tr class="border-b border-app-border">
            <td class="py-2 pr-3 font-semibold">${esc(s.title)}</td>
            <td class="py-2 pr-3">${esc(s.subject)}</td>
            <td class="py-2 pr-3 font-mono">${s.questions?.length ?? 0}</td>
            <td class="py-2 pr-3"><label class="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" ${active ? 'checked' : ''} onchange="toggleSet('${s._id}', this.checked)">
                <span class="text-xs ${active ? 'text-app-accent' : 'text-app-muted'}">${active ? 'Active' : 'Inactive'}</span></label></td>
            <td class="py-2 pr-3 text-xs">${s.isPublic ? 'Public' : 'Private'}</td>
            <td class="py-2 pr-3 whitespace-nowrap">${new Date(s.modifiedAt).toLocaleString()}</td>
            <td class="py-2"><a href="/questionSet/${s._id}" class="bg-app-sec hover:bg-app-sec-hover text-xs px-3 py-1.5 rounded">Edit</a></td></tr>`;
    }).join('');
    box.innerHTML = `<table class="w-full text-sm text-left"><thead>${head}</thead><tbody>${rows}</tbody></table>`;
}

async function toggleSet(id, active) {
    await api(`/api/question-sets/${id}/active`, 'PATCH', { active });
    loadSets();
}

(async () => {
    await loadClasses();
    await loadSets();
})();
