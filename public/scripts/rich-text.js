// Shared renderer for question text: HTML-escaped, $math$ via KaTeX, a small Markdown subset
// (**bold**, *italic*, `code`, "- " bullets, line breaks) and uploaded images ![alt](/uploads/...).
(function () {
    const escape = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const IMG = /!\[([^\]\n]*)\]\((\/uploads\/[a-f0-9]{24}\/[a-f0-9]{32}\.(?:png|jpg|gif|webp))\)/g;

    function formatText(text) {
        return escape(text)
            .replace(IMG, '<img src="$2" alt="$1" class="rich-img">')
            .replace(/`([^`\n]+)`/g, '<code class="rich-code">$1</code>')
            .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
            .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>')
            .replace(/^- /gm, '&bull; ')
            .replace(/\r?\n/g, '<br>');
    }

    window.richHtml = function (raw) {
        return String(raw ?? '').split(/\$(.*?)\$/g)
            .map((p, i) => i % 2 ? katex.renderToString(p, { throwOnError: false }) : formatText(p))
            .join('');
    };

    window.renderMath = function () {
        document.querySelectorAll('.math-render').forEach(el => {
            el.dataset.raw = el.dataset.raw ?? el.textContent;
            el.innerHTML = window.richHtml(el.dataset.raw);
        });
    };

    const style = document.createElement('style');
    style.textContent = `
        .rich-img { display: inline-block; max-width: 100%; max-height: 40vh; margin: 4px 0; border-radius: 6px; vertical-align: middle; }
        .rich-code { background: rgba(148,163,184,.2); padding: 0 4px; border-radius: 4px; font-family: monospace; }
        .rich-small .rich-img { max-height: 14vh; }
        .rich-editor-tools { display: inline-flex; gap: 4px; }`;
    document.head.appendChild(style);
})();
