const socket = io();
const LETTERS = ['A', 'B', 'C', 'D'];
const BTN_ON = 'flex-1 px-2 md:px-4 py-1.5 text-xs font-semibold rounded bg-app-primary text-white transition';
const BTN_OFF = 'flex-1 px-2 md:px-4 py-1.5 text-xs font-semibold rounded hover:bg-app-sec text-app-muted transition';

let session = null;
let questions = [];
let currentIndex = 0;
let displayMode = 'question-options';
let liveResponses = [];
let students = [];
let showCorrect = false;
let unassigned = [];
var labelMode = 'card';

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

async function applySession(s) {
    session = s;
    questions = s.questions;
    currentIndex = s.currentQuestionIndex;
    if (s.displayMode !== 'none') displayMode = s.displayMode;
    liveResponses = [];
    render();

    const [classes, sets] = await Promise.all([
        fetch('/api/classes').then(r => r.json()),
        fetch('/api/question-sets').then(r => r.json())
    ]);
    const cls = classes.find(c => c._id === s.classId);
    const set = sets.find(x => x._id === s.questionSetId);
    document.getElementById('classTitle').textContent = cls ? cls.name : 'Class';
    document.getElementById('setSubtitle').textContent = set ? set.title : 'Question Set';
    students = await fetch(`/api/classes/${s.classId}/students`).then(r => r.json());
    render();
}

function render() {
    renderDisplayButtons();
    renderQuestion();
    renderCheckin();
    renderBars();
}

function renderDisplayButtons() {
    document.getElementById('disp-question').className = displayMode === 'question' ? BTN_ON : BTN_OFF;
    document.getElementById('disp-question-options').className = displayMode === 'question-options' ? BTN_ON : BTN_OFF;
}

function renderQuestion() {
    const promptEl = document.getElementById('questionPrompt');
    const box = document.getElementById('optionsContainer');
    const q = questions[currentIndex];
    if (!q || session.displayMode === 'none') {
        document.getElementById('questionNum').textContent = '';
        promptEl.textContent = 'Waiting for the teacher to start a question...';
        delete promptEl.dataset.raw;
        box.innerHTML = '';
        return;
    }
    document.getElementById('questionNum').textContent = `Question ${currentIndex + 1} of ${questions.length}`;
    promptEl.textContent = q.prompt;
    delete promptEl.dataset.raw;
    box.innerHTML = displayMode === 'question-options'
        ? q.options.map((opt, i) => `
            <div class="bg-app-body border border-app-border p-6 rounded-xl flex items-center gap-4">
                <span class="w-10 h-10 rounded-lg bg-app-primary/20 text-app-accent font-bold flex items-center justify-center">${LETTERS[i]}</span>
                <span class="text-xl math-render rich-small">${esc(opt)}</span>
            </div>`).join('')
        : '';
    renderMath();
}
function setLabel(mode) {
    labelMode = mode;
    document.getElementById('lbl-name').className = `px-3 py-1 text-xs rounded ${mode === 'name' ? BTN_ON : BTN_OFF}`;
    document.getElementById('lbl-card').className = `px-3 py-1 text-xs rounded ${mode === 'card' ? BTN_ON : BTN_OFF}`;
    document.getElementById('lbl-both').className = `px-3 py-1 text-xs rounded ${mode === 'both' ? BTN_ON : BTN_OFF}`;
    renderCheckin();
}
function renderCheckin() {
    
const voted = new Set(liveResponses.map(r => r.studentId._id || r.studentId));

// Sort students based on active labelMode (creates a shallow copy to avoid mutating original state)
const sortedStudents = [...students].sort((a, b) => {
    if (labelMode === 'card') {
        return String(a.cardId).localeCompare(String(b.cardId), undefined, { numeric: true });
    }
    return String(a.name).localeCompare(String(b.name), undefined, { sensitivity: 'base' });
});

// Sort unassigned cards numerically by cardId
const sortedUnassigned = [...unassigned].sort((a, b) => 
    String(a.cardId).localeCompare(String(b.cardId), undefined, { numeric: true })
);

document.getElementById('checkinGrid').innerHTML = sortedStudents.map(s => {
    const v = voted.has(s._id);
    var label; 
    if(labelMode === 'card')
        label=s.cardId;
    if(labelMode === 'name')
        label = s.name;
    if(labelMode === 'both')
        label = s.name + ' (' + s.cardId + ')';
    
    // Updated background and border classes when v is true vs false
    const cardStyle = v 
        ? 'bg-app-primary border-app-success-border/50 text-white' // Custom green background for voted
        : 'bg-app-body border-app-border text-app-muted';            // Slate background for waiting

    return `
        <div class="p-2.5 rounded-lg border text-xs flex justify-between items-center ${cardStyle}">
            <span>${esc(label)}</span>
            <span class="font-mono">${v ? '&#10003; Voted' : 'Waiting'}</span>
        </div>`;
}).join('') + sortedUnassigned.map(u => `
        <div class="p-2.5 rounded-lg border text-xs flex justify-between items-center bg-app-warning/20 border-app-warning/50 text-app-warning">
            <span class="font-mono">Card ${esc(u.cardId)}</span>
            <span class="font-mono">&#10003; Voted</span>
        </div>`).join('');
}

function renderBars() {
    const counts = [0, 0, 0, 0];
    liveResponses.forEach(r => {
        if (r.selectedAnswerIndex >= 0 && r.selectedAnswerIndex <= 3) counts[r.selectedAnswerIndex]++;
    });
    const total = students.length || 1;
    counts.forEach((c, i) => {
        document.getElementById(`count-${i}`).textContent = c;
        document.getElementById(`bar-${i}`).style.height = `${Math.max((c / total) * 100, 5)}%`;
    });
    renderReveal();
}

function renderReveal() {
    const q = questions[currentIndex];
    const el = document.getElementById('correctRevealText');
    if (showCorrect && q && q.questionType !== 'poll') {
        document.getElementById('correctLetter').textContent = LETTERS[q.correctAnswerIndex];
        el.classList.remove('hidden');
    } else {
        el.classList.add('hidden');
    }
}

function toggleReveal() {
    showCorrect = !showCorrect;
    renderReveal();
}

function setMode(mode) {
    ['question', 'checkin', 'results'].forEach(m => {
        document.getElementById(`mode-${m}`).classList.toggle('hidden', m !== mode);
        document.getElementById(`btn-${m}`).className = m === mode ? BTN_ON : BTN_OFF;
    });
}

function present(index, mode) {
    if (!session) return;
    socket.emit('show-question', {
        classId: session.classId,
        questionSetId: session.questionSetId,
        questionIndex: index,
        displayMode: mode
    });
}

function setDisplay(mode) {
    displayMode = mode;
    session.displayMode = mode;
    renderDisplayButtons();
    present(currentIndex, mode);
}

const nextQuestion = () => present(currentIndex + 1, displayMode);
const prevQuestion = () => present(currentIndex - 1, displayMode);

socket.on('connect', () => {
    document.getElementById('statusIndicator').textContent = 'Connected';
    socket.emit('get-session');
});
socket.on('disconnect', () => {
    document.getElementById('statusIndicator').textContent = 'Disconnected';
});
socket.on('connect_error', (err) => {
    if (err.message === 'unauthorized') location.href = `/login?next=${encodeURIComponent(location.pathname)}`;
});

function clearResults() {
    if (!session || session.displayMode === 'none') return;
    if (confirm('Discard all answers to this question and collect them again?')) socket.emit('clear-responses');
}
socket.on('session-updated', applySession);

socket.on('show-question', ({ index, question, displayMode: mode }) => {
    currentIndex = index;
    questions[index] = question;
    displayMode = mode;
    session.displayMode = mode;
    liveResponses = [];
    unassigned = [];
    showCorrect = false;
    render();
});

socket.on('unassigned-scans-updated', (list) => {
    unassigned = list;
    renderCheckin();
});

socket.on('live-responses-updated', (responses) => {
    liveResponses = responses;
    renderCheckin();
    renderBars();
});

renderDisplayButtons();
