const LETTERS = ['A', 'B', 'C', 'D'];
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

async function api(url) {
    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
}

function cellStyle(a, isPoll) {
    if (!a) return 'bg-app-card/40 text-app-muted';
    if (isPoll) return 'bg-app-poll text-white';
    return a.isCorrect ? 'bg-app-primary text-white' : 'bg-app-error text-white';
}

let resultData = null;
const sorter = createSort('results', { key: 'name', dir: 1 }, renderTable);

// Unanswered < incorrect < correct/poll answer.
const answerRank = a => (!a ? -1 : a.isCorrect ? 1 : 0);

function renderTable() {
    const data = resultData;
    const getters = {
        name: s => s.name,
        total: s => s.total,
        answered: s => s.answered,
        correct: s => s.correct
    };
    data.questions.forEach((q, i) => { getters[`q${i}`] = s => answerRank(s.answers[i]); });
    const th = 'px-2 pb-2 text-xs text-app-muted font-semibold';
    const head = `<tr class="border-b border-app-border text-left">
        ${sorter.th('name', 'Student', th)}
        ${data.questions.map((q, i) => sorter.th(`q${i}`, `Q${i + 1}`, `${th} text-center`, `title="${esc(q.prompt)}"`)).join('')}
        ${sorter.th('total', 'Questions', `${th} text-center border-l border-app-border`)}
        ${sorter.th('answered', 'Answered', `${th} text-center`)}
        ${sorter.th('correct', 'Correct', `${th} text-center`)}</tr>`;
    const rows = sorter.apply(data.students, getters).map(s => `<tr class="border-b border-app-border">
        <td class="px-2 py-1.5">${esc(s.name)}</td>
        ${s.answers.map((a, i) => `<td class="px-1 py-1.5 text-center"><span class="inline-block w-7 rounded text-xs font-bold py-0.5 ${cellStyle(a, data.questions[i].questionType === 'poll')}">${a ? LETTERS[a.selectedAnswerIndex] || '?' : '&ndash;'}</span></td>`).join('')}
        <td class="px-2 py-1.5 text-center font-mono border-l border-app-border">${s.total}</td>
        <td class="px-2 py-1.5 text-center font-mono">${s.answered}</td>
        <td class="px-2 py-1.5 text-center font-mono text-app-accent">${s.correct}</td></tr>`).join('');
    $('table').innerHTML = `<thead>${head}</thead><tbody>${rows}</tbody>`;
}

async function load() {
    const classId = $('classSelect').value;
    const setId = $('setSelect').value;
    if (!classId || !setId) {
        $('table').innerHTML = '';
        $('msg').textContent = 'Choose a class and a question set.';
        return;
    }
    try {
        resultData = await api(`/api/classes/${classId}/question-sets/${setId}/results`);
        renderTable();
        $('msg').textContent = resultData.students.length ? '' : 'No students in this class.';
    } catch (e) { $('msg').textContent = e.message; }
}

(async () => {
    const [classes, sets] = await Promise.all([api('/api/classes'), api('/api/question-sets')]);
    $('classSelect').innerHTML = classes.map(c => `<option value="${c._id}">${esc(c.name)}</option>`).join('');
    $('setSelect').innerHTML = sets.map(s => `<option value="${s._id}">${esc(s.title)} (${esc(s.subject)})</option>`).join('');
    load();
})();
