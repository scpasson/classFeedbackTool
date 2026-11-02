const socket = io();
const LETTERS = ['A', 'B', 'C', 'D'];
const BTN_ON = 'bg-app-primary text-white';
const BTN_OFF = 'text-app-muted hover:bg-app-sec';

let questions = [];
let students = [];
let responses = [];
let index = 0;
let live = { index: null, mode: null };
let labelMode = 'name';
let stream = null;

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Helper to get active theme color hex codes for Canvas rendering context
function getCanvasColors() {
    const css = getComputedStyle(document.documentElement);
    return {
        success: css.getPropertyValue('--color-success-border').trim(),
        candidate: css.getPropertyValue('--color-warning').trim()
    };
}

async function init() {
    const [classes, sets] = await Promise.all([
        fetch('/api/classes').then(r => r.json()),
        fetch('/api/question-sets?active=true').then(r => r.json())
    ]);

    $('classSelect').innerHTML = '<option value="" disabled selected>Select a class...</option>' + 
        classes.map(c => `<option value="${c._id}">${esc(c.name)}</option>`).join('');
        
    $('setSelect').innerHTML = '<option value="" disabled selected>Select a question set...</option>' + 
        sets.map(s => `<option value="${s._id}">${esc(s.title)} (${esc(s.subject)})</option>`).join('');

    $('emptyMsg').classList.toggle('hidden', sets.length > 0);
    setLabel('name');    
    await loadCards();
}

async function onClassChange() {
    const id = $('classSelect').value;
    students = id ? await fetch(`/api/classes/${id}/students`).then(r => r.json()) : [];
    responses = [];
    renderResponses();
}

async function loadQuestions() {
    const id = $('setSelect').value;
    questions = id ? await fetch(`/api/question-sets/${id}/questions`).then(r => r.json()) : [];
    index = 0;
    live = { index: null, mode: null };
    responses = [];
    renderPreview();
    renderPagination(index + 1, questions.length);
    renderResponses();
}

// ---------- Preview & presenting ----------
function renderPreview() {
    const q = questions[index];
    $('previewNum').textContent = q ? `Question ${index + 1} of ${questions.length}` : '';
    if (!q) {
        $('preview').innerHTML = '<p class="text-sm text-app-muted">No questions to preview.</p>';
    } else {
        $('preview').innerHTML = `
            <div class="text-xl math-render mb-4">${esc(q.prompt)}</div>
            <div class="grid grid-cols-2 gap-2">
                ${(q.options || []).map((o, i) => `
                    <div class="border rounded p-3 text-sm flex gap-2 ${q.questionType !== 'poll' && i === q.correctAnswerIndex ? 'border-app-success-border bg-app-success-sub' : 'border-app-border'}">
                        <span class="font-bold text-app-accent">${LETTERS[i]}</span><span class="math-render rich-small">${esc(o)}</span>
                    </div>`).join('')}
            </div>`;
        renderMath();
    }
    const isLive = live.index === index;
    $('btnQ').className = `text-sm px-4 py-2 rounded font-semibold ${isLive && live.mode === 'question' ? 'bg-app-primary text-white' : 'bg-app-card hover:bg-app-sec text-app-main'}`;
    $('btnQO').className = `text-sm px-4 py-2 rounded font-semibold ${isLive && live.mode === 'question-options' ? 'bg-app-primary text-white' : 'bg-app-card hover:bg-app-sec text-app-main'}`;
}

function present(mode, i = index) {
    if (!questions[i]) return;
    socket.emit('show-question', {
        classId: $('classSelect').value,
        questionSetId: $('setSelect').value,
        questionIndex: i,
        displayMode: mode
    });
}

function goToQuestion(input) {
    const next = input;
    if (next < 0 || next >= questions.length) return;
    index = next;
    renderPreview();
    renderPagination(index + 1, questions.length);
    renderResponses();
}

function step(delta) {
    const next = index + delta;
    if (next < 0 || next >= questions.length) return;
    index = next;
    renderPreview();
    renderPagination(index + 1, questions.length);
    renderResponses();
}

socket.on('show-question', ({ index: i, displayMode }) => {
    live = { index: i, mode: displayMode };
    index = i;
    responses = [];
    sent.clear();
    renderPreview();
    renderResponses();
});

socket.on('live-responses-updated', (list) => {
    responses = list;
    renderResponses();
});

socket.on('responses-cleared', () => sent.clear());

socket.on('connect_error', (err) => {
    if (err.message === 'unauthorized') location.href = `/login?next=${encodeURIComponent(location.pathname)}`;
});

function clearResults() {
    if (live.index === null) return alert('Present a question first.');
    if (confirm('Discard all answers to the live question and collect them again?')) socket.emit('clear-responses');
}

// ---------- Camera ----------
async function startCapture() {
    if (stream) return;
    if (!navigator.mediaDevices?.getUserMedia) {
        $('camMsg').textContent = window.isSecureContext
            ? 'This browser has no camera support.'
            : 'Camera needs HTTPS or localhost. Open this page via https:// or http://localhost:3000.';
        return;
    }
    try {
        stream = await navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: { ideal: 'environment' },
                width: { ideal: 1920 },
                height: { ideal: 1080 }
            },
            audio: false
        });
        const video = $('video');
        video.srcObject = stream;
        await video.play();
        $('camMsg').textContent = `Capturing ${video.videoWidth}x${video.videoHeight}`;
        scanTimer = setInterval(scanFrame, 250);
    } catch (e) {
        if (stream) stream.getTracks().forEach(t => t.stop());
        stream = null;
        $('camMsg').textContent = `Camera unavailable: ${e.name}\n${e.message}`;
    }
}

function stopCapture() {
    clearInterval(scanTimer);
    scanTimer = null;
    clearOverlay();
    if (stream) stream.getTracks().forEach(t => t.stop());
    stream = null;
    $('video').srcObject = null;
    $('camMsg').textContent = 'Stopped';
}

// ---------- Card scanning ----------
const MIN_STABLE_FRAMES = 2;
let cards = [];
let scanTimer = null;
const stable = new Map(); 
const sent = new Map();   

async function loadCards() {
    cards = await fetch('/api/cards').then(r => r.json());
    $('cardCount').textContent = cards.length;
    $('cardList').innerHTML = cards.map(c => `
        <span class="bg-app-body border border-app-border rounded px-2 py-1 text-xs font-mono flex items-center gap-2">${esc(c.cardId)}
            <button onclick="deleteCard('${esc(c.cardId)}')" class="text-app-error hover:opacity-80">&times;</button></span>`).join('');
}

function clearOverlay() {
    const c = $('overlay');
    c.getContext('2d').clearRect(0, 0, c.width, c.height);
}

function drawOverlay(result) {
    const c = $('overlay');
    c.width = result.width;
    c.height = result.height;
    const ctx = c.getContext('2d');
    ctx.lineWidth = 3;
    ctx.font = 'bold 20px sans-serif';
    
    const colors = getCanvasColors();

    const outline = (corners, color) => {
        ctx.strokeStyle = color;
        ctx.beginPath();
        corners.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.closePath();
        ctx.stroke();
    };
    
    const matched = new Set(result.detections.map(d => d.corners));
    result.candidates.forEach(c2 => { if (!matched.has(c2.corners)) outline(c2.corners, colors.candidate); });
    result.detections.forEach(d => {
        outline(d.corners, colors.success);
        ctx.fillStyle = colors.success;
        ctx.fillText(`${d.cardId}:${LETTERS[d.answerIndex]}`, d.corners[0][0], Math.max(18, d.corners[0][1] - 6));
    });
}

function scanFrame() {
    const video = $('video');
    if (!video.videoWidth) return;
    const result = CardReader.readFrame(video, cards);
    drawOverlay(result);
    $('scanMsg').textContent = cards.length ? `Cards in view: ${result.detections.length}` : 'No cards learned yet. Open the card library below.';

    const inView = new Set();
    for (const d of result.detections) {
        inView.add(d.cardId);
        const s = stable.get(d.cardId);
        const count = s && s.answer === d.answerIndex ? s.count + 1 : 1;
        stable.set(d.cardId, { answer: d.answerIndex, count });
        if (count >= MIN_STABLE_FRAMES && live.index !== null && sent.get(d.cardId) !== d.answerIndex) {
            sent.set(d.cardId, d.answerIndex);
            socket.emit('submit-card-scan', { cardId: d.cardId, answerIndex: d.answerIndex });
        }
    }
    for (const id of [...stable.keys()]) if (!inView.has(id)) stable.delete(id);
}

async function learnCard() {
    const id = $('learnId').value.trim();
    const video = $('video');
    if (!id) return alert('Enter the card number first.');
    if (!video.videoWidth) return alert('Start capture first.');
    const { candidates } = CardReader.readFrame(video, []);
    if (!candidates.length) return alert('No card found. Hold it flat, upright and well lit.');
    const best = candidates.reduce((a, b) => (b.rect.w * b.rect.h > a.rect.w * a.rect.h ? b : a));
    const grid = CardReader.gridToString(CardReader.uprightGrid(best.grid, best.rect.angle));
    await fetch(`/api/cards/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ grid })
    });
    $('learnId').value = '';
    await loadCards();
}

async function deleteCard(id) {
    await fetch(`/api/cards/${encodeURIComponent(id)}`, { method: 'DELETE' });
    await loadCards();
}

// ---------- Responses ----------
function setLabel(mode) {
    labelMode = mode;
    $('lbl-name').className = `px-3 py-1 text-xs rounded ${mode === 'name' ? BTN_ON : BTN_OFF}`;
    $('lbl-card').className = `px-3 py-1 text-xs rounded ${mode === 'card' ? BTN_ON : BTN_OFF}`;
    renderResponses();
}

function renderResponses() {
    const q = questions[index];
    const byStudent = new Map(responses.map(r => [String(r.studentId._id || r.studentId), r]));
    const sortedStudents = [...students].sort((a, b) => {
        if (labelMode === 'card') {
            return String(a.cardId).localeCompare(String(b.cardId), undefined, { numeric: true });
        }
        return String(a.name).localeCompare(String(b.name), undefined, { sensitivity: 'base' });
    });
    $('responseGrid').innerHTML = sortedStudents.map(s => {
        const r = byStudent.get(s._id);
        let style = 'bg-app-card border-app-border text-app-muted';
        let answer = '';
        if (r) {
            answer = LETTERS[r.selectedAnswerIndex] || '';
            if (q && q.questionType === 'poll') style = 'bg-app-poll border-app-poll-border text-white';
            else style = r.isCorrect ? 'bg-app-success border-app-success-border text-white' : 'bg-app-error border-app-error-border text-white';
        }
        const label = labelMode === 'card' ? s.cardId : s.name;
        return `<div class="border rounded p-2 text-xs flex justify-between items-center ${style}">
            <span class="${labelMode === 'card' ? 'font-mono' : ''}">${esc(label)}</span><span class="font-bold">${answer}</span></div>`;
    }).join('') || '<p class="text-xs text-app-muted col-span-full">No students in this class.</p>';
}

function renderPagination(currentPage, totalPages) {
    const container = document.getElementById('pagination-container');
    
    if (totalPages <= 1) {
        container.innerHTML = '';
        return;
    }

    container.innerHTML = `
        <div class="flex gap-1">
            ${Array.from({ length: totalPages }, (_, i) => {
                const pageNum = i + 1;
                const isActive = pageNum === currentPage;
                const activeClasses = 'bg-app-primary border-app-primary text-white';
                const inactiveClasses = 'bg-app-card border-app-border hover:bg-app-sec text-app-muted';
                
                return `<button onclick="goToQuestion(${pageNum - 1})" class="px-3 py-1 text-sm rounded border ${isActive ? activeClasses : inactiveClasses}">${pageNum}</button>`;
            }).join('')}
        </div>
    `;
}

init();