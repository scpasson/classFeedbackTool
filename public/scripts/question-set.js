    const LETTERS = ['A', 'B', 'C', 'D'];
        let set = null;
        let canEdit = false;
        let setQuestions = [];
        let results = [];
        let editingId = null;
        let setEdit = null;
        let previewAll = false;
        const openQs = new Set();
        const BLANK_QUESTION = { _id: '', questionType: 'multiple-choice', prompt: '', options: ['', '', '', ''], correctAnswerIndex: 0, tags: [], shuffleOptions: false };
        let searchTimer;

        const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        const input = 'bg-app-body border border-app-border p-1.5 rounded text-xs w-full';

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

        const currentSetId = () => SET_ID;

        // ---------- Images ----------
        // Images go into whichever prompt/option field was focused last; paste and drop work directly on a field.
        let lastField = null;
        const fileInput = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/png,image/jpeg,image/gif,image/webp' });

        document.addEventListener('focusin', e => {
            if (e.target.matches('input[type="text"], input:not([type])') && e.target.closest('#bulkBody, #setQuestions, #results')) lastField = e.target;
        });

        async function uploadImage(file) {
            const res = await fetch('/api/uploads', { method: 'POST', headers: { 'Content-Type': file.type }, body: file });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Upload failed');
            return data.url;
        }

        async function insertImage(field, file) {
            if (!field || !file) return;
            try {
                const url = await uploadImage(file);
                const md = `![image](${url})`;
                const at = field.selectionStart ?? field.value.length;
                field.value = field.value.slice(0, at) + md + field.value.slice(field.selectionEnd ?? at);
                field.focus();
            } catch (e) { alert(e.message); }
        }

        function pickImage() {
            if (!lastField || !document.contains(lastField)) return alert('Click the prompt or option field first, then choose Image.');
            const target = lastField;
            fileInput.value = '';
            fileInput.onchange = () => insertImage(target, fileInput.files[0]);
            fileInput.click();
        }

        document.addEventListener('paste', e => {
            const file = [...(e.clipboardData?.files || [])].find(f => f.type.startsWith('image/'));
            if (file && e.target.closest?.('#bulkBody, #setQuestions, #results') && e.target.tagName === 'INPUT') {
                e.preventDefault();
                insertImage(e.target, file);
            }
        });

        document.addEventListener('dragover', e => { if (e.target.closest?.('#bulkBody, #setQuestions, #results')) e.preventDefault(); });
        document.addEventListener('drop', e => {
            const file = [...(e.dataTransfer?.files || [])].find(f => f.type.startsWith('image/'));
            if (file && e.target.tagName === 'INPUT' && e.target.closest('#bulkBody, #setQuestions, #results')) {
                e.preventDefault();
                insertImage(e.target, file);
            }
        });

        // ---------- Set ----------
        async function loadSet() {
            set = await api(`/api/question-sets/${SET_ID}`);
            canEdit = set.mine;
            document.querySelectorAll('.owner-only').forEach(el => el.classList.toggle('hidden', !canEdit));
            document.getElementById('pageTitle').textContent = set.title;
            document.title = set.title;
            document.getElementById('viewerInfo').innerHTML = `${esc(set.subject)} &middot; by ${set.mine ? 'you' : esc(set.ownerName)} &middot; ${set.isPublic ? 'Public' : 'Private'} &middot; modified ${new Date(set.modifiedAt).toLocaleString()}${(set.tags || []).length ? ' &middot; ' + set.tags.map(t => '#' + esc(t)).join(' ') : ''}`;
            document.getElementById('setTitle').value = set.title;
            document.getElementById('setSubject').value = set.subject;
            document.getElementById('setTags').value = (set.tags || []).join(', ');
            document.getElementById('setActive').checked = set.active !== false;
            document.getElementById('setPublic').checked = set.isPublic;
            updateActions();
            if (!canEdit) previewAll = true;
            document.getElementById('previewAllBtn').textContent = previewAll ? 'Hide all previews' : 'Preview all';
            await loadSetQuestions();
        }

        // Bookmark and clone need an account.
        function updateActions() {
            const bm = document.getElementById('bookmarkBtn');
            const cl = document.getElementById('cloneBtn');
            bm.classList.toggle('hidden', set.mine);
            bm.textContent = set.bookmarked ? 'Unbookmark' : 'Bookmark';
            bm.disabled = cl.disabled = !set.loggedIn;
            bm.title = cl.title = set.loggedIn ? '' : 'Log in to use this';
        }

        async function toggleBookmark() {
            try {
                await api(`/api/question-sets/${SET_ID}/bookmark`, set.bookmarked ? 'DELETE' : 'PUT');
                set.bookmarked = !set.bookmarked;
                updateActions();
            } catch (e) { alert(e.message); }
        }

        async function cloneSet() {
            try {
                const copy = await api(`/api/question-sets/${SET_ID}/clone`, 'POST');
                location.href = `/questionSet/${copy._id}`;
            } catch (e) { alert(e.message); }
        }

        async function copyLink() {
            const msg = document.getElementById('actionMsg');
            try {
                await navigator.clipboard.writeText(location.origin + `/questionSet/${SET_ID}`);
                msg.textContent = set.isPublic ? 'Link copied.' : 'Link copied, but this set is private so only you can open it.';
            } catch { msg.textContent = location.href; }
        }

        async function saveSet() {
            const body = {
                title: document.getElementById('setTitle').value.trim(),
                subject: document.getElementById('setSubject').value.trim(),
                tags: document.getElementById('setTags').value,
                active: document.getElementById('setActive').checked,
                isPublic: document.getElementById('setPublic').checked
            };
            if (!body.title || !body.subject) return alert('Title and subject are required.');
            try {
                await api(`/api/question-sets/${SET_ID}`, 'PUT', body);
                await loadSet();
            } catch (e) { alert(e.message); }
        }

        async function deleteSet() {
            if (!confirm('Delete this set? Its questions stay in the question bank.')) return;
            await api(`/api/question-sets/${SET_ID}`, 'DELETE');
            location.href = '/questionSets';
        }

        async function loadSetQuestions() {
            setQuestions = await api(`/api/question-sets/${SET_ID}/questions`);
            renderSetQuestions();
        }

        function renderSetQuestions() {
            const box = document.getElementById('setQuestions');
            if (!setQuestions.length) {
                box.innerHTML = '<p class="text-xs text-app-muted">No questions in this set yet.</p>';
                return;
            }
            box.innerHTML = setQuestions.map((q, i) => {
                const editing = setEdit && setEdit.id === q._id;
                const open = editing || previewAll || openQs.has(q._id);
                const typeBadge = `<span class="text-[10px] px-1.5 py-0.5 rounded ${q.questionType === 'poll' ? 'bg-app-warning/20 text-app-warning' : 'bg-app-success-sub text-app-success-border'}">${q.questionType === 'poll' ? 'poll' : 'MC'}</span>`;
                const row = `
                <div class="bg-app-body border ${open ? 'border-app-success-border' : 'border-app-border'} rounded p-2 text-xs flex flex-col gap-2">
                    <div class="flex items-center gap-2">
                        <button onclick="togglePreview('${q._id}')" title="Preview this question" class="font-bold w-10 py-1 rounded ${open ? 'bg-app-success text-white' : 'bg-app-card hover:bg-app-sec text-app-main'}">Q${i + 1}</button>
                        ${typeBadge}
                        <span class="flex-1 math-render">${esc(q.prompt)}</span>
                        ${canEdit ? `${open && !editing ? `<button onclick="startSetEdit('${q._id}')" class="px-2 py-1 bg-app-card rounded hover:bg-app-sec">Edit</button>` : ''}
                        <button onclick="duplicateInSet(${i})" title="Copy this question right after itself" class="px-2 py-1 bg-app-card rounded hover:bg-app-sec">Duplicate</button>
                        <button onclick="startInsert(${i})" title="Insert a new question after this one" class="px-2 py-1 bg-app-card rounded hover:bg-app-sec">Insert</button>
                        <button onclick="moveInSet(${i}, -1)" class="px-2 py-1 bg-app-card rounded hover:bg-app-sec">&uarr;</button>
                        <button onclick="moveInSet(${i}, 1)" class="px-2 py-1 bg-app-card rounded hover:bg-app-sec">&darr;</button>
                        <button onclick="removeFromSet(${i})" class="px-2 py-1 bg-app-danger rounded hover:bg-app-danger-hover">Remove</button>` : ''}
                    </div>
                    ${editing ? editRow(q, 's', `saveSetEdit('${q._id}')`, 'cancelSetEdit()') : open ? previewBody(q) : ''}
                </div>`;
                const insertForm = setEdit && setEdit.insertAfter === i ? editRow(BLANK_QUESTION, 's', 'saveInsert()', 'cancelSetEdit()') : '';
                return row + insertForm;
            }).join('');
            renderMath();
        }

        function previewBody(q) {
            return `
                <div class="bg-app-body rounded p-4 flex flex-col gap-3">
                    <div class="text-lg math-render">${esc(q.prompt)}</div>
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
                        ${(q.options || []).map((o, k) => `<div class="rounded border p-2 text-sm ${q.questionType !== 'poll' && k === q.correctAnswerIndex ? 'border-app-success-border bg-app-success-sub text-app-main' : 'border-app-border text-app-muted'}"><span class="font-bold mr-2">${LETTERS[k]}</span><span class="math-render rich-small">${esc(o)}</span></div>`).join('')}
                    </div>
                    <div class="text-app-muted">${q.shuffleOptions ? '&#8644; shuffled when presented &middot; ' : ''}${(q.tags || []).map(t => `#${esc(t)}`).join(' ')}</div>
                </div>`;
        }

        function togglePreview(id) {
            if (openQs.has(id)) openQs.delete(id); else openQs.add(id);
            renderSetQuestions();
        }

        function togglePreviewAll() {
            previewAll = !previewAll;
            if (!previewAll) openQs.clear();
            setEdit = null;
            document.getElementById('previewAllBtn').textContent = previewAll ? 'Hide all previews' : 'Preview all';
            renderSetQuestions();
        }

        function startSetEdit(id) { setEdit = { id }; renderSetQuestions(); }
        function startInsert(i) { setEdit = { insertAfter: i }; renderSetQuestions(); }
        function cancelSetEdit() { setEdit = null; renderSetQuestions(); }

        async function saveSetEdit(id) {
            const body = readEditor('s');
            if (!body) return;
            try {
                await api(`/api/questions/${id}`, 'PUT', body);
                setEdit = null;
                await loadSetQuestions();
                search();
            } catch (e) { alert(e.message); }
        }

        async function insertAfter(i, body) {
            const created = await api('/api/questions', 'POST', { questions: [body] });
            const ids = setQuestions.map(q => q._id);
            ids.splice(i + 1, 0, created[0]._id);
            await saveOrder(ids);
            return created[0]._id;
        }

        async function saveInsert() {
            const body = readEditor('s');
            if (!body) return;
            try {
                const i = setEdit.insertAfter;
                setEdit = null;
                const newId = await insertAfter(i, body);
                openQs.add(newId);
                renderSetQuestions();
            } catch (e) { alert(e.message); }
        }

        async function duplicateInSet(i) {
            const { prompt, options, correctAnswerIndex, questionType, tags, shuffleOptions } = setQuestions[i];
            try {
                await insertAfter(i, { prompt, options, correctAnswerIndex, questionType, tags, shuffleOptions });
            } catch (e) { alert(e.message); }
        }

        async function saveOrder(ids) {
            setQuestions = await api(`/api/question-sets/${currentSetId()}/questions`, 'PUT', { questionIds: ids });
            renderSetQuestions();
            search();
        }

        function moveInSet(i, delta) {
            const j = i + delta;
            if (j < 0 || j >= setQuestions.length) return;
            const ids = setQuestions.map(q => q._id);
            [ids[i], ids[j]] = [ids[j], ids[i]];
            saveOrder(ids);
        }

        function removeFromSet(i) {
            saveOrder(setQuestions.map(q => q._id).filter((_, k) => k !== i));
        }

        async function addToSet(questionId) {
            if (!currentSetId()) return alert('Select or save a set first.');
            const ids = setQuestions.map(q => q._id);
            if (ids.includes(questionId)) return;
            await saveOrder([...ids, questionId]);
        }

        // ---------- Bulk add ----------
        function addBulkRow() {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td class="pr-2 pb-2"><select class="${input} b-type" onchange="toggleRowType(this)"><option value="multiple-choice">MC</option><option value="poll">Poll</option></select></td>
                <td class="pr-2 pb-2 min-w-64"><input class="${input} b-prompt"></td>
                ${[0, 1, 2, 3].map(() => `<td class="pr-2 pb-2"><input class="${input} b-opt"></td>`).join('')}
                <td class="pr-2 pb-2"><select class="${input} b-correct">${LETTERS.map((l, i) => `<option value="${i}">${l}</option>`).join('')}</select></td>
                <td class="pr-2 pb-2"><input class="${input} b-tags" placeholder="a, b"></td>
                <td class="pr-2 pb-2 text-center"><input type="checkbox" class="b-shuffle" ${document.getElementById('shuffleDefault').checked ? 'checked' : ''}></td>
                <td class="pb-2"><button onclick="this.closest('tr').remove()" class="px-2 py-1 bg-app-card rounded hover:bg-app-sec">&times;</button></td>`;
            document.getElementById('bulkBody').appendChild(tr);
            return tr;
        }

        // Columns in paste order; each entry sets one control from a pasted string.
        const BULK_CELLS = [
            { sel: '.b-type', set: (el, v) => { el.value = /^p/i.test(v) ? 'poll' : 'multiple-choice'; toggleRowType(el); } },
            { sel: '.b-prompt' },
            { sel: '.b-opt', nth: 0 }, { sel: '.b-opt', nth: 1 }, { sel: '.b-opt', nth: 2 }, { sel: '.b-opt', nth: 3 },
            { sel: '.b-correct', set: (el, v) => { const i = LETTERS.indexOf(v.trim().toUpperCase()); if (i >= 0) el.value = i; } },
            { sel: '.b-tags' },
            { sel: '.b-shuffle', set: (el, v) => { el.checked = /^(1|true|yes|y|x)$/i.test(v.trim()); } }
        ];

        function bulkControls(tr) {
            return BULK_CELLS.map(c => ({ el: tr.querySelectorAll(c.sel)[c.nth || 0], set: c.set }));
        }

        document.getElementById('bulkBody').addEventListener('paste', (e) => {
            const target = e.target;
            const startRow = target.closest('tr');
            if (!startRow || target.type === 'checkbox') return;
            const text = (e.clipboardData || window.clipboardData).getData('text');
            const lines = text.split(/\r\n|\n|\r/).filter(l => l.trim() !== '');
            // A single value pastes normally into the cell.
            if (lines.length === 0 || (lines.length === 1 && !lines[0].includes('\t'))) return;
            e.preventDefault();

            const body = document.getElementById('bulkBody');
            const rows = [...body.rows];
            const startRowIdx = rows.indexOf(startRow);
            const startCol = bulkControls(startRow).findIndex(c => c.el === target);
            if (startCol < 0) return;

            lines.forEach((line, r) => {
                let tr = rows[startRowIdx + r];
                if (!tr) { tr = addBulkRow(); rows.push(tr); }
                const controls = bulkControls(tr);
                line.split('\t').forEach((val, c) => {
                    const ctl = controls[startCol + c];
                    if (!ctl) return;
                    if (ctl.set) ctl.set(ctl.el, val); else ctl.el.value = val.trim();
                });
            });
        });

        function toggleRowType(sel) {
            sel.closest('tr').querySelector('.b-correct').disabled = sel.value === 'poll';
        }

        async function submitBulk() {
            const msg = document.getElementById('bulkMsg');
            const rows = [...document.querySelectorAll('#bulkBody tr')];
            // Rows left completely blank are ignored.
            const questions = rows.map(tr => ({
                questionType: tr.querySelector('.b-type').value,
                prompt: tr.querySelector('.b-prompt').value,
                options: [...tr.querySelectorAll('.b-opt')].map(o => o.value),
                correctAnswerIndex: tr.querySelector('.b-correct').value,
                tags: tr.querySelector('.b-tags').value,
                shuffleOptions: tr.querySelector('.b-shuffle').checked
            })).filter(q => q.prompt.trim() || q.options.some(o => o.trim()));

            if (!questions.length) { msg.className = 'text-xs text-app-error-border'; msg.textContent = 'Nothing to save.'; return; }
            const bad = questions.findIndex(q => !q.prompt.trim() || q.options.some(o => !o.trim()));
            if (bad >= 0) { msg.className = 'text-xs text-app-error-border'; msg.textContent = `Row ${bad + 1}: prompt and all 4 options are required.`; return; }

            try {
                const useSet = document.getElementById('addToSet').checked && currentSetId();
                await api('/api/questions', 'POST', { questions, questionSetId: useSet || undefined });
                msg.className = 'text-xs text-app-accent';
                msg.textContent = `Saved ${questions.length} question(s).`;
                document.getElementById('bulkBody').innerHTML = '';
                addBulkRow();
                await loadSetQuestions();
                search();
            } catch (e) { msg.className = 'text-xs text-app-error-border'; msg.textContent = e.message; }
        }

        // ---------- Search / edit ----------
        function debouncedSearch() {
            clearTimeout(searchTimer);
            searchTimer = setTimeout(search, 250);
        }

        async function search() {
            const params = new URLSearchParams({
                q: document.getElementById('searchQ').value,
                type: document.getElementById('searchType').value,
                shared: document.getElementById('searchShared').checked
            });
            results = await api(`/api/questions?${params}`);
            renderResults();
        }

        function renderResults() {
            const box = document.getElementById('results');
            if (!results.length) { box.innerHTML = '<p class="text-xs text-app-muted">No questions found.</p>'; return; }
            const inSet = new Set(setQuestions.map(q => q._id));
            box.innerHTML = results.map(q => q._id === editingId ? editRow(q) : `
                <div class="bg-app-body border border-app-border rounded p-3 text-xs flex flex-col gap-1">
                    <div class="flex items-center gap-2">
                        <span class="text-[10px] px-1.5 py-0.5 rounded ${q.questionType === 'poll' ? 'bg-app-warning/20 text-app-warning' : 'bg-app-success-sub text-app-success-border'}">${q.questionType === 'poll' ? 'poll' : 'MC'}</span>
                        <span class="flex-1 math-render">${esc(q.prompt)}</span>
                        ${q.shared
                            ? `<button onclick="copyToSet('${q._id}')" class="px-2 py-1 bg-app-card rounded hover:bg-app-sec">Copy to set</button>`
                            : `<button onclick="addToSet('${q._id}')" ${inSet.has(q._id) ? 'disabled' : ''} class="px-2 py-1 bg-app-card rounded hover:bg-app-sec disabled:opacity-40">${inSet.has(q._id) ? 'In set' : 'Add to set'}</button>
                        <button onclick="startEdit('${q._id}')" class="px-2 py-1 bg-app-card rounded hover:bg-app-sec">Edit</button>
                        <button onclick="deleteQuestion('${q._id}')" class="px-2 py-1 bg-app-danger rounded hover:bg-app-danger-hover">Delete</button>`}
                    </div>
                    <div class="grid grid-cols-2 gap-x-4 text-app-muted">
                        ${(q.options || []).map((o, i) => `<span class="${q.questionType !== 'poll' && i === q.correctAnswerIndex ? 'text-app-accent' : ''}">${LETTERS[i]}. <span class="math-render rich-small">${esc(o)}</span></span>`).join('')}
                    </div>
                    <div class="text-app-muted">${q.shuffleOptions ? '&#8644; shuffled &middot; ' : ''}${(q.tags || []).map(t => `#${esc(t)}`).join(' ')} ${q.sets.length ? '&middot; Sets: ' + q.sets.map(s => esc(s.title)).join(', ') : ''}</div>
                </div>`).join('');
            renderMath();
        }

        // p is an id prefix so the search editor ('e') and set editor ('s') can be open together.
        function editRow(q, p = 'e', saveCall = `saveEdit('${q._id}')`, cancelCall = 'cancelEdit()') {
            return `
                <div class="bg-app-body border border-app-success-border rounded p-3 text-xs flex flex-col gap-2">
                    <div class="flex gap-2">
                        <select id="${p}-type" onchange="document.getElementById('${p}-correct').disabled = this.value === 'poll'" class="${input} !w-32">
                            <option value="multiple-choice" ${q.questionType !== 'poll' ? 'selected' : ''}>Multiple choice</option>
                            <option value="poll" ${q.questionType === 'poll' ? 'selected' : ''}>Poll</option>
                        </select>
                        <input id="${p}-prompt" class="${input}" placeholder="Prompt" value="${esc(q.prompt)}">
                    </div>
                    <div class="grid grid-cols-2 gap-2" id="${p}-opts">
                        ${[0, 1, 2, 3].map(i => `<input class="${input}" placeholder="Option ${LETTERS[i]}" value="${esc((q.options || [])[i])}">`).join('')}
                    </div>
                    <div class="flex gap-2 items-center">
                        <label class="text-app-muted">Correct</label>
                        <select id="${p}-correct" ${q.questionType === 'poll' ? 'disabled' : ''} class="${input} !w-20">
                            ${LETTERS.map((l, i) => `<option value="${i}" ${q.correctAnswerIndex === i ? 'selected' : ''}>${l}</option>`).join('')}
                        </select>
                        <input id="${p}-tags" class="${input}" placeholder="Tags" value="${esc((q.tags || []).join(', '))}">
                        <label class="text-app-muted flex items-center gap-1 whitespace-nowrap"><input type="checkbox" id="${p}-shuffle" ${q.shuffleOptions ? 'checked' : ''}> Shuffle</label>
                        <button onclick="pickImage()" title="Insert an image at the cursor in the last field you clicked" class="px-3 py-1.5 bg-app-card rounded hover:bg-app-sec">Image</button>
                        <button onclick="${saveCall}" class="px-3 py-1.5 bg-app-primary rounded font-semibold hover:bg-app-primary-hover">Save</button>
                        <button onclick="${cancelCall}" class="px-3 py-1.5 bg-app-card rounded hover:bg-app-sec">Cancel</button>
                    </div>
                </div>`;
        }

        function readEditor(p) {
            const options = [...document.querySelectorAll(`#${p}-opts input`)].map(o => o.value);
            const body = {
                questionType: document.getElementById(`${p}-type`).value,
                prompt: document.getElementById(`${p}-prompt`).value,
                options,
                correctAnswerIndex: document.getElementById(`${p}-correct`).value,
                tags: document.getElementById(`${p}-tags`).value,
                shuffleOptions: document.getElementById(`${p}-shuffle`).checked
            };
            if (!body.prompt.trim() || options.some(o => !o.trim())) { alert('Prompt and all 4 options are required.'); return null; }
            return body;
        }

        function startEdit(id) { editingId = id; renderResults(); }
        function cancelEdit() { editingId = null; renderResults(); }

        async function saveEdit(id) {
            const body = readEditor('e');
            if (!body) return;
            try {
                await api(`/api/questions/${id}`, 'PUT', body);
                editingId = null;
                await loadSetQuestions();
                await search();
            } catch (e) { alert(e.message); }
        }

        async function deleteQuestion(id) {
            if (!confirm('Delete this question from the bank and every set that uses it?')) return;
            await api(`/api/questions/${id}`, 'DELETE');
            await loadSetQuestions();
            await search();
        }

        async function copyToSet(questionId) {
            try {
                await api(`/api/questions/${questionId}/clone`, 'POST', { questionSetId: currentSetId() || undefined });
                await loadSetQuestions();
                document.getElementById('searchShared').checked = false;
                await search();
            } catch (e) { alert(e.message); }
        }

        (async () => {
            addBulkRow();
            try { await loadSet(); } catch (e) { document.getElementById('viewerInfo').textContent = e.message; return; }
            if (canEdit) await search();
        })();