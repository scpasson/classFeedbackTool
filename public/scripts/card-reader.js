// Finds 5x5 black/white cards in a camera frame and identifies card number + orientation.
(function (root) {
    const N = 5;

    function grabFrame(video, maxWidth = 1280) {
        const maxDim = Math.max(video.videoWidth, video.videoHeight);
        const scale = Math.min(1, maxWidth / maxDim);
        const w = Math.round(video.videoWidth * scale);
        const h = Math.round(video.videoHeight * scale);
        const canvas = grabFrame.canvas || (grabFrame.canvas = document.createElement('canvas'));
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(video, 0, 0, w, h);
        return ctx.getImageData(0, 0, w, h);
    }

    function toGrayscale(img) {
        const { data, width, height } = img;
        const gray = new Uint8Array(width * height);
        for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
            gray[i] = (data[p] * 77 + data[p + 1] * 150 + data[p + 2] * 29) >> 8;
        }
        return gray;
    }

    // 1 = darker than its local neighbourhood; copes with uneven lighting and screen glare.
    function darkMask(gray, w, h, radius = Math.max(12, Math.min(32, Math.round(w / 36))), offset = 10) {
        const stride = w + 1;
        const ii = new Uint32Array(stride * (h + 1));
        for (let y = 0; y < h; y++) {
            let rowSum = 0;
            for (let x = 0; x < w; x++) {
                rowSum += gray[y * w + x];
                ii[(y + 1) * stride + x + 1] = ii[y * stride + x + 1] + rowSum;
            }
        }
        const mask = new Uint8Array(w * h);
        for (let y = 0; y < h; y++) {
            const y0 = Math.max(0, y - radius), y1 = Math.min(h - 1, y + radius);
            for (let x = 0; x < w; x++) {
                const x0 = Math.max(0, x - radius), x1 = Math.min(w - 1, x + radius);
                const area = (x1 - x0 + 1) * (y1 - y0 + 1);
                const sum = ii[(y1 + 1) * stride + x1 + 1] - ii[y0 * stride + x1 + 1]
                    - ii[(y1 + 1) * stride + x0] + ii[y0 * stride + x0];
                if (gray[y * w + x] * area < sum - offset * area) mask[y * w + x] = 1;
            }
        }
        return mask;
    }

    // Square-window dilation, done as two 1-D passes.
    function dilate(mask, w, h, r) {
        if (r <= 0) return mask;
        const tmp = new Uint8Array(w * h);
        const out = new Uint8Array(w * h);
        const prefix = new Int32Array(Math.max(w, h) + 1);
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) prefix[x + 1] = prefix[x] + mask[y * w + x];
            for (let x = 0; x < w; x++) {
                tmp[y * w + x] = prefix[Math.min(w, x + r + 1)] - prefix[Math.max(0, x - r)] > 0 ? 1 : 0;
            }
        }
        for (let x = 0; x < w; x++) {
            for (let y = 0; y < h; y++) prefix[y + 1] = prefix[y] + tmp[y * w + x];
            for (let y = 0; y < h; y++) {
                out[y * w + x] = prefix[Math.min(h, y + r + 1)] - prefix[Math.max(0, y - r)] > 0 ? 1 : 0;
            }
        }
        return out;
    }

    function labelComponents(mask, w, h) {
        const labels = new Int32Array(w * h);
        const queue = new Int32Array(w * h);
        const comps = [];
        for (let start = 0; start < mask.length; start++) {
            if (!mask[start] || labels[start]) continue;
            const id = comps.length + 1;
            let head = 0, tail = 0;
            queue[tail++] = start;
            labels[start] = id;
            let minX = w, minY = h, maxX = 0, maxY = 0;
            while (head < tail) {
                const p = queue[head++];
                const x = p % w, y = (p - x) / w;
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
                if (x > 0 && mask[p - 1] && !labels[p - 1]) { labels[p - 1] = id; queue[tail++] = p - 1; }
                if (x < w - 1 && mask[p + 1] && !labels[p + 1]) { labels[p + 1] = id; queue[tail++] = p + 1; }
                if (y > 0 && mask[p - w] && !labels[p - w]) { labels[p - w] = id; queue[tail++] = p - w; }
                if (y < h - 1 && mask[p + w] && !labels[p + w]) { labels[p + w] = id; queue[tail++] = p + w; }
            }
            comps.push({ id, area: tail, minX, minY, maxX, maxY });
        }
        return { labels, comps };
    }

    function convexHull(points) {
        const pts = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
        if (pts.length < 3) return pts;
        const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
        const build = (list) => {
            const hull = [];
            for (const p of list) {
                while (hull.length >= 2 && cross(hull[hull.length - 2], hull[hull.length - 1], p) <= 0) hull.pop();
                hull.push(p);
            }
            hull.pop();
            return hull;
        };
        return build(pts).concat(build(pts.slice().reverse()));
    }

    // Smallest rotated rectangle around the hull. u/v form a right-handed frame in image coordinates (y down).
    function minAreaRect(hull) {
        let best = null;
        for (let i = 0; i < hull.length; i++) {
            const a = hull[i], b = hull[(i + 1) % hull.length];
            const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
            const ux = Math.cos(ang), uy = Math.sin(ang), vx = -uy, vy = ux;
            let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
            for (const p of hull) {
                const pu = p[0] * ux + p[1] * uy, pv = p[0] * vx + p[1] * vy;
                if (pu < minU) minU = pu;
                if (pu > maxU) maxU = pu;
                if (pv < minV) minV = pv;
                if (pv > maxV) maxV = pv;
            }
            const area = (maxU - minU) * (maxV - minV);
            if (!best || area < best.area) {
                const mu = (minU + maxU) / 2, mv = (minV + maxV) / 2;
                best = {
                    area, w: maxU - minU, h: maxV - minV, ux, uy, vx, vy,
                    cx: ux * mu + vx * mv, cy: uy * mu + vy * mv,
                    angle: ang * 180 / Math.PI
                };
            }
        }
        return best;
    }

    function rectCorners(r) {
        return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => [
            r.cx + r.ux * a * r.w / 2 + r.vx * b * r.h / 2,
            r.cy + r.uy * a * r.w / 2 + r.vy * b * r.h / 2
        ]);
    }

    // Candidate card regions:
    // In every card, the black squares form a connected region, all 4 corners are black,
    // and the middle square is white.
    function findCandidates(gray, w, h, opts = {}) {
        const minSide = opts.minSide || 10;
        const radii = opts.radii || [0, 1];
        const mask = darkMask(gray, w, h);
        const out = [];
        const seenCentroids = [];

        for (const r of radii) {
            const curMask = r > 0 ? dilate(mask, w, h, r) : mask;
            const { labels, comps } = labelComponents(curMask, w, h);

            for (const c of comps) {
                const bw = c.maxX - c.minX + 1;
                const bh = c.maxY - c.minY + 1;
                if (bw < minSide || bh < minSide) continue;
                if (bw > w * 0.98 || bh > h * 0.98) continue;
                const bRatio = bw / bh;
                if (bRatio < 0.5 || bRatio > 2.0) continue;

                // Fill factor check: 5x5 cards have 18-22 black cells (72%-88% of card area).
                // In a rotated bounding box, fill is between ~0.25 (45 deg) and ~0.95.
                const fill = c.area / (bw * bh);
                if (fill < 0.25 || fill > 0.95) continue;

                // The middle square of the card is always white.
                // Center of bounding box is (minX+maxX)/2, (minY+maxY)/2.
                // In r=0, a solid dark object will have a dark center, so reject it immediately.
                const midX = Math.round((c.minX + c.maxX) / 2);
                const midY = Math.round((c.minY + c.maxY) / 2);
                if (r === 0 && curMask[midY * w + midX]) continue;

                const pts = [];
                const step = Math.max(1, Math.floor(c.area / 1500));
                let n = 0;
                for (let y = c.minY; y <= c.maxY; y++) {
                    for (let x = c.minX; x <= c.maxX; x++) {
                        const p = y * w + x;
                        if (curMask[p] && labels[p] === c.id && (n++ % step === 0)) pts.push([x, y]);
                    }
                }
                if (pts.length < 8) continue;

                const rect = minAreaRect(convexHull(pts));
                if (!rect) continue;
                const ratio = rect.w / rect.h;
                if (ratio < 0.7 || ratio > 1.43) continue;
                if (Math.min(rect.w, rect.h) < minSide) continue;

                // Deduplicate across radii
                const isDup = seenCentroids.some(pt => Math.hypot(pt.cx - rect.cx, pt.cy - rect.cy) < Math.min(rect.w, rect.h) * 0.4);
                if (isDup) continue;
                seenCentroids.push({ cx: rect.cx, cy: rect.cy });

                out.push(rect);
            }
        }
        return out;
    }

    // Reads the 5x5 cells (row-major, 1 = black) in the rectangle's own frame.
    // Uses structural card features: 4 corners are always black, middle square is always white.
    function sampleGrid(gray, w, h, rect, opts = {}) {
        const vals = [];
        const offsets = rect.w < 25 ? [-0.15, 0, 0.15] : [-0.2, 0, 0.2];
        for (let r = 0; r < N; r++) {
            for (let c = 0; c < N; c++) {
                let sum = 0, count = 0;
                for (const oy of offsets) {
                    for (const ox of offsets) {
                        const a = ((c + 0.5 + ox) / N - 0.5) * rect.w;
                        const b = ((r + 0.5 + oy) / N - 0.5) * rect.h;
                        const x = Math.round(rect.cx + rect.ux * a + rect.vx * b);
                        const y = Math.round(rect.cy + rect.uy * a + rect.vy * b);
                        if (x < 0 || y < 0 || x >= w || y >= h) return null;
                        sum += gray[y * w + x];
                        count++;
                    }
                }
                vals.push(sum / count);
            }
        }
        const lo = Math.min(...vals), hi = Math.max(...vals);
        const minContrast = (opts && opts.minContrast) || 25;
        if (hi - lo < minContrast) return null;
        const t = (lo + hi) / 2;
        const grid = vals.map(v => (v < t ? 1 : 0));

        // Invariant 1: Middle square (index 12, row 2 col 2) is ALWAYS white (0)
        if (grid[12] !== 0) return null;

        // Invariant 2: Four corners (0, 4, 20, 24) are ALWAYS black (1)
        const cornerBlackCount = grid[0] + grid[4] + grid[20] + grid[24];
        if (cornerBlackCount < 3) return null;

        // Center white value should be brighter than corner black average
        const cornerAvg = (vals[0] + vals[4] + vals[20] + vals[24]) / 4;
        if (vals[12] <= cornerAvg + 8) return null;

        return grid;
    }

    function rotateCW(grid) {
        const out = new Array(N * N);
        for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) out[r * N + c] = grid[(N - 1 - c) * N + r];
        return out;
    }

    const rotateCWTimes = (grid, k) => { for (let i = 0; i < ((k % 4) + 4) % 4; i++) grid = rotateCW(grid); return grid; };
    const gridToString = g => g.join('');
    const stringToGrid = s => s.split('').map(Number);

    // cards: [{ cardId, grid: '0101...' }] stored upright with answer A on top.
    function matchCard(grid, cards, maxDist = 2) {
        const rotations = [0, 1, 2, 3].map(k => rotateCWTimes(grid, k));
        let best = null, secondDist = Infinity;
        for (const card of cards) {
            const target = stringToGrid(card.grid);
            let cardBest = null;
            rotations.forEach((g, k) => {
                let d = 0;
                for (let i = 0; i < g.length; i++) if (g[i] !== target[i]) d++;
                if (!cardBest || d < cardBest.dist) cardBest = { cardId: card.cardId, rotation: k, dist: d };
            });
            if (!best || cardBest.dist < best.dist) {
                if (best) secondDist = Math.min(secondDist, best.dist);
                best = cardBest;
            } else {
                secondDist = Math.min(secondDist, cardBest.dist);
            }
        }
        if (!best || best.dist > maxDist || secondDist <= best.dist) return null;
        return best;
    }

    // Answer letter (0=A..3=D) on top, assuming letters run A top, B right, C bottom, D left.
    function answerIndex(rotation, frameAngleDeg) {
        return (((Math.round((90 * rotation - frameAngleDeg) / 90)) % 4) + 4) % 4;
    }

    // Turns a sampled grid into the upright form stored in the card database.
    function uprightGrid(grid, frameAngleDeg) {
        return rotateCWTimes(grid, Math.round(frameAngleDeg / 90));
    }

    function readImage(gray, w, h, cards, opts = {}) {
        const candidates = [];
        const detections = [];
        const seen = new Set();
        for (const rect of findCandidates(gray, w, h, opts)) {
            const grid = sampleGrid(gray, w, h, rect, opts);
            if (!grid) continue;
            const corners = rectCorners(rect);
            candidates.push({ rect, grid, corners });
            const m = matchCard(grid, cards, opts.maxDist);
            if (!m || seen.has(m.cardId)) continue;
            seen.add(m.cardId);
            detections.push({ cardId: m.cardId, distance: m.dist, answerIndex: answerIndex(m.rotation, rect.angle), corners });
        }
        return { width: w, height: h, detections, candidates };
    }

    function readFrame(video, cards, opts) {
        const img = grabFrame(video, opts && opts.maxWidth);
        return readImage(toGrayscale(img), img.width, img.height, cards, opts);
    }

    const api = {
        grabFrame, toGrayscale, darkMask, dilate, labelComponents, convexHull, minAreaRect,
        rectCorners, findCandidates, sampleGrid, rotateCW, matchCard, answerIndex, uprightGrid,
        gridToString, readImage, readFrame
    };
    if (typeof module !== 'undefined') module.exports = api;
    root.CardReader = api;
})(typeof window !== 'undefined' ? window : globalThis);
