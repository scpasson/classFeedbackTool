// Click-to-sort table headers. createSort(id, {key, dir}, rerender) returns { th(), apply() }.
function createSort(id, initial, rerender) {
    window.__sorters = window.__sorters || {};
    const state = { key: initial.key, dir: initial.dir ?? 1 };
    const blank = v => v === null || v === undefined || v === '';
    const sorter = {
        state,
        toggle(key) {
            if (state.key === key) state.dir = -state.dir;
            else { state.key = key; state.dir = 1; }
            rerender();
        },
        th(key, label, cls = '', attrs = '') {
            const arrow = state.key === key ? (state.dir === 1 ? ' \u25B2' : ' \u25BC') : '';
            return `<th ${attrs} class="${cls} cursor-pointer select-none hover:text-app-main" onclick="__sorters['${id}'].toggle('${key}')">${label}${arrow}</th>`;
        },
        // getters maps a column key to a function returning a number or string; blanks sort last.
        apply(rows, getters) {
            const get = getters[state.key];
            if (!get) return rows;
            return [...rows].sort((a, b) => {
                const av = get(a), bv = get(b);
                if (blank(av) || blank(bv)) return blank(av) === blank(bv) ? 0 : (blank(av) ? 1 : -1);
                const r = typeof av === 'number' && typeof bv === 'number'
                    ? av - bv
                    : String(av).localeCompare(String(bv), undefined, { sensitivity: 'base', numeric: true });
                return r * state.dir;
            });
        }
    };
    window.__sorters[id] = sorter;
    return sorter;
}
