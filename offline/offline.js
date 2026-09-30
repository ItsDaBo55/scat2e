/* SCAT 2e offline helper: quizzes, flashcards, forms, navigation.
   Loaded after offline/data.js on every course page, index.html and quiz.html. */
(function () {
  'use strict';
  var D = window.SCAT;
  if (!D) return;
  var SRC = (document.currentScript && document.currentScript.src) || '';
  var ROOT = SRC ? new URL('../', SRC).href : '';

  /* ---------- tiny helpers ---------- */
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function h(tag, attrs, kids) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'class') e.className = attrs[k];
      else if (k === 'html') e.innerHTML = attrs[k];
      else if (k === 'text') e.textContent = attrs[k];
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== false && attrs[k] != null) e.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  function shuffle(a) {
    a = a.slice();
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  function fmtTime(s) { var m = Math.floor(s / 60), r = s % 60; return m + ':' + (r < 10 ? '0' : '') + r; }
  function fmtDate(ts) { var d = new Date(ts); return (d.getMonth() + 1 < 10 ? '0' : '') + (d.getMonth() + 1) + '/' + (d.getDate() < 10 ? '0' : '') + d.getDate() + '/' + d.getFullYear(); }

  /* ---------- storage (localStorage with in-memory fallback) ---------- */
  var KEY = 'scat2e:v1', memo = null;
  function readDB() {
    var o = null;
    try { o = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { o = memo; }
    if (!o || typeof o !== 'object') o = {};
    o.visited = o.visited || {}; o.attempts = o.attempts || []; o.cards = o.cards || {}; o.notes = o.notes || {};
    return o;
  }
  function update(fn) {
    var o = readDB(); fn(o); memo = o;
    try { localStorage.setItem(KEY, JSON.stringify(o)); } catch (e) { /* private mode: memory only */ }
    return o;
  }

  /* ---------- question generation ---------- */
  function wc(s) { return s.split(/\s+/).length; }
  function baseOf(t) { return t.replace(/\s*\([^)]*\)\s*$/, '').trim(); }
  function acrOf(t) { var m = t.match(/\(([^)]+)\)\s*$/); return m ? m[1] : null; }
  function related(a, b) {
    a = baseOf(a).toLowerCase(); b = baseOf(b).toLowerCase();
    return a === b || a.indexOf(b) >= 0 || b.indexOf(a) >= 0;
  }
  function chapterItems(n) {
    return (D.gloss[n] || []).map(function (p) { return { ch: +n, term: p[0], def: p[1] }; });
  }
  function allItems() {
    var out = []; Object.keys(D.gloss).forEach(function (n) { out = out.concat(chapterItems(n)); }); return out;
  }
  function pickDistractors(cur, key, n) {
    var pool = chapterItems(cur.ch).filter(function (x) { return !related(x.term, cur.term) && x.def !== cur.def; });
    if (pool.length < n + 2) {
      pool = pool.concat(allItems().filter(function (x) { return x.ch !== cur.ch && !related(x.term, cur.term) && x.def !== cur.def; }));
    }
    if (key === 'def') pool = pool.filter(function (x) { return x.def.length <= 260; });
    pool = shuffle(pool);
    if (key === 'term') {
      var w = wc(cur.term);
      pool = pool.slice(0, 40).sort(function (a, b) { return Math.abs(wc(a.term) - w) - Math.abs(wc(b.term) - w); }).slice(0, Math.max(n * 3, 9));
      pool = shuffle(pool);
    }
    var seen = {}, out = [];
    seen[key === 'term' ? cur.term : cur.def] = 1;
    for (var i = 0; i < pool.length && out.length < n; i++) {
      var v = key === 'term' ? pool[i].term : pool[i].def;
      if (!seen[v]) { seen[v] = 1; out.push(v); }
    }
    return out;
  }
  function finishQ(q, correct, wrong) {
    var opts = shuffle([correct].concat(wrong));
    q.options = opts; q.answer = opts.indexOf(correct); return q;
  }
  function qDefToTerm(it) {
    var wrong = pickDistractors(it, 'term', 3);
    return finishQ({
      type: 'term', ch: it.ch, term: it.term, kind: 'Definition → Term',
      prompt: 'Which term matches this definition?', body: it.def,
      explain: '<strong>' + esc(it.term) + '</strong> — ' + esc(it.def)
    }, it.term, wrong);
  }
  function qTermToDef(it) {
    var wrong = pickDistractors(it, 'def', 3);
    return finishQ({
      type: 'def', ch: it.ch, term: it.term, kind: 'Term → Definition',
      prompt: 'Which definition best matches this term?', body: it.term,
      explain: '<strong>' + esc(it.term) + '</strong> — ' + esc(it.def)
    }, it.def, wrong);
  }
  function qCloze(n, c) {
    var items = chapterItems(n), pool = [], ans;
    var m = c.a.toLowerCase();
    if (c.k === 'a') {
      items.forEach(function (i) { var a = acrOf(i.term); if (a && a.toUpperCase() === a) pool.push(a); });
      ans = c.a;
    } else {
      items.forEach(function (i) { pool.push(baseOf(i.term)); });
      ans = null;
      pool.forEach(function (p) { if (p.toLowerCase() === m) ans = p; });
      if (!ans) ans = c.a;
    }
    var sent = c.s.replace(/_____/g, '_____');
    var cap = /^_____/.test(sent);
    var wrong = shuffle(pool.filter(function (p) {
      if (related(p, ans)) return false;
      var rx = new RegExp('(^|[^\\w])' + p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^\\w])', 'i');
      var plain = sent.replace(/_____/g, ' ');
      return !rx.test(plain);
    }));
    if (wrong.length < 3) return null;
    var capA = /^[A-Z]/.test(ans);
    var sameCap = wrong.filter(function (x) { return /^[A-Z]/.test(x) === capA; });
    if (sameCap.length >= 3) wrong = sameCap;
    var w = wc(ans);
    wrong = shuffle(wrong.slice(0, 40).sort(function (a, b) { return Math.abs(wc(a) - w) - Math.abs(wc(b) - w); }).slice(0, 9)).slice(0, 3);
    if (cap) { ans = ans.charAt(0).toUpperCase() + ans.slice(1); wrong = wrong.map(function (x) { return x.charAt(0).toUpperCase() + x.slice(1); }); }
    return finishQ({
      type: 'cloze', ch: n, term: ans, kind: 'Fill in the blank',
      prompt: 'Choose the word or phrase that best completes this statement from the chapter summary.', body: sent,
      explain: esc(sent).replace(/_____/g, '<strong>' + esc(ans) + '</strong>')
    }, ans, wrong);
  }
  /* mode: 'practice' allows cloze questions; 'exam' uses definition-based questions only (unambiguous) */
  function makeQuestions(chs, count, mode) {
    var items = [], clozes = [];
    chs.forEach(function (n) {
      items = items.concat(chapterItems(n));
      if (mode !== 'exam') (D.cloze[n] || []).forEach(function (c) { clozes.push({ n: n, c: c }); });
    });
    items = shuffle(items); clozes = shuffle(clozes);
    var total = items.length; count = Math.min(count, total + Math.min(clozes.length, Math.round(total * 0.3)));
    var wantCloze = mode === 'exam' ? 0 : Math.min(clozes.length, Math.round(count * 0.25));
    var qs = [];
    for (var i = 0; i < clozes.length && qs.length < wantCloze; i++) {
      var q = qCloze(clozes[i].n, clozes[i].c); if (q) qs.push(q);
    }
    var need = count - qs.length, k = 0;
    while (need > 0 && k < items.length) {
      var it = items[k++];
      var useDef = it.def.length <= 220 && Math.random() < (mode === 'exam' ? 0.25 : 0.3);
      qs.push(useDef ? qTermToDef(it) : qDefToTerm(it)); need--;
    }
    qs = shuffle(qs);
    qs.forEach(function (q, i) { q.id = i; });
    return qs;
  }
  function reshuffleQ(q) {
    var correct = q.options[q.answer]; q.options = shuffle(q.options); q.answer = q.options.indexOf(correct); return q;
  }

  /* ---------- quiz UI ---------- */
  var LETTERS = 'ABCDEFGH';
  function chLabel(chs) {
    if (chs.length === Object.keys(D.chapters).length) return 'All chapters';
    if (chs.length === 1) return 'Chapter ' + chs[0];
    return 'Chapters ' + chs.join(', ');
  }
  function attemptsFor(key) { return readDB().attempts.filter(function (a) { return a.key === key; }); }
  function pct(a) { return Math.round(100 * a.score / a.total); }
  function statusHTML(key) {
    var at = attemptsFor(key);
    if (!at.length) return '<strong>Your status:</strong> No attempts yet on this device.';
    var last = at[at.length - 1], best = Math.max.apply(null, at.map(pct));
    return '<strong>Your status:</strong> Last attempt ' + fmtDate(last.ts) + ' — <b>' + pct(last) + '%</b> (' + last.score + '/' + last.total + ')' +
      ' · Best <b>' + best + '%</b> · ' + at.length + ' attempt' + (at.length > 1 ? 's' : '');
  }
  function record(cfg, score, total, secs) {
    update(function (o) {
      o.attempts.push({ key: cfg.key, mode: cfg.mode, label: cfg.label, score: score, total: total, secs: secs, ts: Date.now() });
      if (o.attempts.length > 300) o.attempts = o.attempts.slice(-300);
    });
  }

  /* cfg: {chs:[..], mode:'practice'|'exam', count, key, label, choose:false} */
  function launcher(root, cfg) {
    root.innerHTML = '';
    root.classList.add('sq');
    var chs = cfg.chs.slice();
    var total = 0; chs.forEach(function (n) { total += (D.gloss[n] || []).length; });
    var box = h('div', { class: 'sq-launch' });
    var status = h('div', { class: 'sq-status', html: statusHTML(cfg.key) });
    box.appendChild(status);
    box.appendChild(h('p', { class: 'sq-note', html: 'Offline mode: these questions are generated from the course glossary' + (cfg.mode === 'exam' ? '' : ' and chapter summaries') + '. They are <b>not</b> the original online questions, and scores are saved on this device only.' }));
    var sel = h('select', { id: 'sq-count-' + cfg.key.replace(/\W/g, '') });
    var opts = cfg.counts || (cfg.mode === 'exam' ? [25, 50, 75, 100] : [10, 20, 30, 50]);
    var start = cfg.count || opts[0];
    var mx = Math.min(total, 150);
    opts.filter(function (x) { return x <= mx; }).forEach(function (x) { sel.appendChild(h('option', { value: x, text: x + ' questions' })); });
    if (!sel.options.length || mx < opts[0]) sel.appendChild(h('option', { value: mx, text: mx + ' questions' }));
    sel.value = String(Math.min(start, mx)); if (!sel.value) sel.selectedIndex = 0;
    if (!cfg.fixed) box.appendChild(h('label', { class: 'sq-field' }, ['How many? ', sel]));
    var btn = h('button', { type: 'button', class: 'sq-btn sq-primary', text: cfg.mode === 'exam' ? 'Begin exam' : (attemptsFor(cfg.key).length ? 'Begin a new attempt' : 'Begin practice') });
    btn.addEventListener('click', function () {
      var n = cfg.fixed ? cfg.count : parseInt(sel.value, 10);
      run(root, cfg, makeQuestions(chs, n, cfg.mode), function () { launcher(root, cfg); });
    });
    box.appendChild(btn);
    root.appendChild(box);
    return { start: function () { btn.click(); } };
  }

  function run(root, cfg, qs, back) {
    if (cfg.mode === 'exam') return runExam(root, cfg, qs, back);
    return runPractice(root, cfg, qs, back);
  }

  function retryCfg(cfg) { return { chs: cfg.chs, mode: 'practice', key: cfg.key + ':retry', label: cfg.label.replace(/ \(missed\)$/, '') + ' (missed)' }; }

  /* practice: one question at a time with instant feedback */
  function runPractice(root, cfg, qs, back) {
    var i = 0, score = 0, missed = [], t0 = Date.now(), locked = false;
    root.innerHTML = '';
    var head = h('div', { class: 'sq-head' });
    var bar = h('div', { class: 'sq-bar' }, [h('div', { class: 'sq-bar-in' })]);
    var card = h('div', { class: 'sq-card', 'aria-live': 'polite' });
    root.appendChild(head); root.appendChild(bar); root.appendChild(card);
    function paintHead() {
      head.innerHTML = '<span><b>' + esc(cfg.label) + '</b> · Practice</span><span>Question ' + Math.min(i + 1, qs.length) + ' of ' + qs.length + ' · Score ' + score + '</span>';
      $('.sq-bar-in', bar).style.width = (100 * i / qs.length) + '%';
    }
    function show() {
      locked = false; paintHead(); card.innerHTML = '';
      var q = qs[i];
      card.appendChild(h('div', { class: 'sq-kind', text: q.kind + ' · Chapter ' + q.ch }));
      card.appendChild(h('p', { class: 'sq-prompt', text: q.prompt }));
      card.appendChild(h('div', { class: 'sq-body' + (q.type === 'def' ? ' sq-body-term' : ''), text: q.body }));
      var list = h('div', { class: 'sq-opts', role: 'radiogroup', 'aria-label': 'Answer choices' });
      q.options.forEach(function (o, k) {
        var lab = h('label', { class: 'sq-opt', 'data-k': k }, [
          h('input', { type: 'radio', name: 'sq-p-' + i, value: k }),
          h('span', { class: 'sq-key', text: LETTERS[k] }),
          h('span', { class: 'sq-txt', text: o })
        ]);
        $('input', lab).addEventListener('change', function () { choose(k); });
        list.appendChild(lab);
      });
      card.appendChild(list);
      card.appendChild(h('div', { class: 'sq-fb', id: 'sq-fb', role: 'status' }));
    }
    function choose(k) {
      if (locked) return; locked = true;
      var q = qs[i], ok = k === q.answer;
      var rin = $$('.sq-opt input', card)[k]; if (rin) rin.checked = true;
      if (ok) score++; else missed.push({ q: q, picked: k });
      $$('.sq-opt', card).forEach(function (lab, idx) {
        $('input', lab).disabled = true;
        if (idx === q.answer) lab.classList.add('sq-right');
        else if (idx === k) lab.classList.add('sq-wrong');
      });
      var fb = $('#sq-fb', card);
      fb.className = 'sq-fb ' + (ok ? 'sq-fb-ok' : 'sq-fb-bad');
      fb.innerHTML = '<div class="sq-verdict">' + (ok ? '✓ Correct' : '✗ Not quite — the answer is ' + LETTERS[q.answer]) + '</div><div class="sq-explain">' + q.explain + '</div>';
      var last = i === qs.length - 1;
      var nb = h('button', { type: 'button', class: 'sq-btn sq-primary', id: 'sq-next', text: last ? 'See results' : 'Next question →' });
      nb.addEventListener('click', function () { i++; if (i >= qs.length) done(); else show(); });
      fb.appendChild(nb); nb.focus({ preventScroll: true });
      paintHead();
    }
    function done() {
      var secs = Math.round((Date.now() - t0) / 1000);
      record(cfg, score, qs.length, secs);
      i = qs.length; paintHead();
      results(root, cfg, qs, score, secs, missed.map(function (m) { return { q: m.q, picked: m.picked }; }), back, function (subset) {
        runPractice(root, retryCfg(cfg), subset.map(reshuffleQ).map(function (q, k) { q.id = k; return q; }), back);
      });
    }
    function onKey(e) {
      if (!card.isConnected) { document.removeEventListener('keydown', onKey); return; }
      if (i >= qs.length || e.altKey || e.ctrlKey || e.metaKey) return;
      var tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'textarea' || tag === 'select' || (tag === 'input' && e.target.type !== 'radio')) return;
      if (!locked) {
        var k = '1234'.indexOf(e.key); if (k < 0) k = 'abcd'.indexOf(String(e.key).toLowerCase());
        if (k >= 0 && k < qs[i].options.length) { choose(k); e.preventDefault(); }
      } else if (e.key === 'Enter') {
        var nb = $('#sq-next', card); if (nb && e.target !== nb) { nb.click(); e.preventDefault(); }
      }
    }
    document.addEventListener('keydown', onKey);
    show();
  }

  function results(root, cfg, qs, score, secs, wrongList, back, retry) {
    var p = Math.round(100 * score / qs.length);
    root.innerHTML = '';
    var wrap = h('div', { class: 'sq-results' });
    wrap.appendChild(h('div', { class: 'sq-score ' + (p >= 80 ? 'good' : p >= 60 ? 'ok' : 'low') }, [
      h('div', { class: 'sq-pct', text: p + '%' }),
      h('div', { class: 'sq-frac', text: score + ' of ' + qs.length + ' correct' + (secs ? ' · ' + fmtTime(secs) : '') })
    ]));
    wrap.appendChild(h('p', { class: 'sq-msg', text: p >= 90 ? 'Excellent work.' : p >= 75 ? 'Solid — review the misses below and go again.' : p >= 60 ? 'Getting there. Flash cards are a good next step.' : 'Worth another pass through the chapter and its flash cards.' }));
    var row = h('div', { class: 'sq-actions' });
    if (wrongList.length) row.appendChild(h('button', { type: 'button', class: 'sq-btn sq-primary', text: 'Retry ' + wrongList.length + ' missed', onclick: function () { retry(wrongList.map(function (w) { return w.q; })); } }));
    row.appendChild(h('button', { type: 'button', class: 'sq-btn', text: cfg.mode === 'exam' ? 'Take a new exam' : 'New set of questions', onclick: back }));
    wrap.appendChild(row);
    if (wrongList.length) {
      wrap.appendChild(h('h3', { class: 'sq-h3', text: 'Review of missed questions' }));
      wrongList.forEach(function (w) {
        var q = w.q;
        var it = h('div', { class: 'sq-review' });
        it.appendChild(h('div', { class: 'sq-kind', text: q.kind + ' · Chapter ' + q.ch }));
        it.appendChild(h('div', { class: 'sq-body' + (q.type === 'def' ? ' sq-body-term' : ''), text: q.body }));
        if (w.picked != null && w.picked >= 0) it.appendChild(h('div', { class: 'sq-you', html: '<span class="sq-x">Your answer:</span> ' + esc(q.options[w.picked]) }));
        else it.appendChild(h('div', { class: 'sq-you', html: '<span class="sq-x">Your answer:</span> <em>left blank</em>' }));
        it.appendChild(h('div', { class: 'sq-corr', html: '<span class="sq-ok">Correct:</span> ' + esc(q.options[q.answer]) }));
        if (q.type === 'term' || q.type === 'def') it.appendChild(h('div', { class: 'sq-explain', html: q.explain }));
        wrap.appendChild(it);
      });
    }
    root.appendChild(wrap);
    try { root.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) {}
  }

  /* exam: all questions on one page, graded on submit */
  function runExam(root, cfg, qs, back) {
    var t0 = Date.now(), answers = {}, submitted = false, timer;
    root.innerHTML = '';
    var top = h('div', { class: 'sq-examtop' });
    var clock = h('span', { class: 'sq-clock', text: '0:00' });
    var prog = h('span', { class: 'sq-prog' });
    var submit = h('button', { type: 'button', class: 'sq-btn sq-primary', text: 'Submit exam' });
    top.appendChild(h('span', { html: '<b>' + esc(cfg.label) + '</b> · Exam' }));
    top.appendChild(prog); top.appendChild(h('span', {}, ['⏱ ', clock])); top.appendChild(submit);
    root.appendChild(top);
    var warn = h('div', { class: 'sq-warn', style: 'display:none' });
    root.appendChild(warn);
    var jump = h('div', { class: 'sq-jump', 'aria-label': 'Question navigator' });
    qs.forEach(function (q, k) {
      jump.appendChild(h('a', { href: '#sq-q' + k, class: 'sq-dot', id: 'sq-dot' + k, text: k + 1 }));
    });
    root.appendChild(jump);
    var form = h('div', { class: 'sq-exam' });
    qs.forEach(function (q, k) {
      var c = h('div', { class: 'sq-card sq-qcard', id: 'sq-q' + k });
      c.appendChild(h('div', { class: 'sq-kind', text: 'Question ' + (k + 1) + ' of ' + qs.length }));
      c.appendChild(h('p', { class: 'sq-prompt', text: q.prompt }));
      c.appendChild(h('div', { class: 'sq-body' + (q.type === 'def' ? ' sq-body-term' : ''), text: q.body }));
      var list = h('div', { class: 'sq-opts', role: 'radiogroup', 'aria-label': 'Answer choices for question ' + (k + 1) });
      q.options.forEach(function (o, j) {
        var lab = h('label', { class: 'sq-opt' }, [
          h('input', { type: 'radio', name: 'sq-e-' + k, value: j }),
          h('span', { class: 'sq-key', text: LETTERS[j] }), h('span', { class: 'sq-txt', text: o })]);
        $('input', lab).addEventListener('change', function () {
          if (submitted) return; answers[k] = j; paint(); warn.style.display = 'none';
        });
        list.appendChild(lab);
      });
      c.appendChild(list); form.appendChild(c);
    });
    root.appendChild(form);
    var bottom = h('div', { class: 'sq-actions' }, [h('button', { type: 'button', class: 'sq-btn sq-primary', text: 'Submit exam', onclick: function () { attempt(); } })]);
    root.appendChild(bottom);
    function paint() {
      var n = Object.keys(answers).length;
      prog.textContent = n + ' / ' + qs.length + ' answered';
      qs.forEach(function (q, k) { $('#sq-dot' + k, root).classList.toggle('done', answers[k] != null); });
    }
    function tick() { clock.textContent = fmtTime(Math.round((Date.now() - t0) / 1000)); }
    timer = setInterval(function () { if (!root.isConnected) { clearInterval(timer); return; } tick(); }, 1000);
    function attempt() {
      var left = qs.length - Object.keys(answers).length;
      if (left > 0 && !warn.dataset.confirmed) {
        warn.style.display = ''; warn.innerHTML = '';
        warn.appendChild(h('span', { text: left + ' question' + (left > 1 ? 's are' : ' is') + ' unanswered. Unanswered questions count as incorrect.' }));
        warn.appendChild(h('button', { type: 'button', class: 'sq-btn', text: 'Go back', onclick: function () { warn.style.display = 'none'; var k = qs.findIndex(function (q, x) { return answers[x] == null; }); var t = $('#sq-q' + k, root); if (t) t.scrollIntoView({ behavior: 'smooth', block: 'center' }); } }));
        warn.appendChild(h('button', { type: 'button', class: 'sq-btn sq-primary', text: 'Submit anyway', onclick: function () { warn.dataset.confirmed = '1'; attempt(); } }));
        try { warn.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {}
        return;
      }
      finish();
    }
    submit.addEventListener('click', attempt);
    function finish() {
      submitted = true; clearInterval(timer);
      var secs = Math.round((Date.now() - t0) / 1000), score = 0, wrong = [];
      qs.forEach(function (q, k) { if (answers[k] === q.answer) score++; else wrong.push({ q: q, picked: answers[k] == null ? -1 : answers[k] }); });
      record(cfg, score, qs.length, secs);
      results(root, cfg, qs, score, secs, wrong, back, function (subset) {
        runPractice(root, retryCfg(cfg), subset.map(reshuffleQ), back);
      });
    }
    paint();
  }

  /* standalone chooser (quiz.html) */
  function chooser(root, params) {
    root.classList.add('sq'); root.innerHTML = '';
    var nums = Object.keys(D.chapters).map(Number).sort(function (a, b) { return a - b; });
    var want = params.ch === 'all' || !params.ch ? nums : String(params.ch).split(',').map(Number).filter(function (n) { return D.chapters[n]; });
    var mode = params.mode === 'exam' ? 'exam' : 'practice';
    var box = h('div', { class: 'sq-launch sq-choose' });
    box.appendChild(h('h2', { class: 'sq-h2', text: 'Build a quiz' }));
    var modes = h('div', { class: 'sq-modes' });
    ['practice', 'exam'].forEach(function (m) {
      var l = h('label', { class: 'sq-mode' }, [h('input', { type: 'radio', name: 'sq-mode', value: m }), h('span', {}, [h('b', { text: m === 'exam' ? 'Exam' : 'Practice' }), h('small', { text: m === 'exam' ? 'All questions on one page, graded when you submit, timed.' : 'One question at a time with instant feedback.' })])]);
      if (m === mode) $('input', l).checked = true;
      modes.appendChild(l);
    });
    box.appendChild(modes);
    var fs = h('fieldset', { class: 'sq-chs' }, [h('legend', { text: 'Chapters' })]);
    var allBtn = h('button', { type: 'button', class: 'sq-link', text: 'Select all / none' });
    fs.appendChild(allBtn);
    var grid = h('div', { class: 'sq-chgrid' });
    nums.forEach(function (n) {
      var l = h('label', { class: 'sq-ch' }, [h('input', { type: 'checkbox', value: n }), h('span', { text: n + '. ' + D.chapters[n].title })]);
      if (want.indexOf(n) >= 0) $('input', l).checked = true;
      grid.appendChild(l);
    });
    fs.appendChild(grid); box.appendChild(fs);
    allBtn.addEventListener('click', function () {
      var boxes = $$('input', grid), any = boxes.some(function (b) { return !b.checked; });
      boxes.forEach(function (b) { b.checked = any; });
    });
    var sel = h('select', {}, [10, 20, 25, 30, 50, 75, 100].map(function (x) { return h('option', { value: x, text: x + ' questions' }); }));
    sel.value = params.n || (mode === 'exam' ? '25' : '10');
    if (!sel.value) sel.value = '25';
    box.appendChild(h('label', { class: 'sq-field' }, ['How many? ', sel]));
    var msg = h('div', { class: 'sq-warn', style: 'display:none', text: 'Pick at least one chapter.' });
    var go = h('button', { type: 'button', class: 'sq-btn sq-primary', text: 'Start' });
    box.appendChild(msg); box.appendChild(go); root.appendChild(box);
    function start() {
      var chs = $$('input', grid).filter(function (b) { return b.checked; }).map(function (b) { return +b.value; });
      if (!chs.length) { msg.style.display = ''; return; }
      var m = $('input[name=sq-mode]:checked', box).value;
      var cfg = { chs: chs, mode: m, key: 'mix:' + m + ':' + chs.join('-'), label: chLabel(chs) };
      var qs = makeQuestions(chs, parseInt(sel.value, 10), m);
      var back = function () { chooser(root, { ch: chs.join(','), mode: m, n: sel.value }); };
      run(root, cfg, qs, back);
    }
    go.addEventListener('click', start);
    if (params.go === '1') start();
  }

  /* ---------- flash cards ---------- */
  function flashcards(mountEl, terms, ch) {
    var known = (readDB().cards[ch] || {});
    var order = terms.map(function (_, i) { return i; }), pos = 0, flipped = false, faceDown = false, onlyNew = false;
    mountEl.innerHTML = '';
    mountEl.classList.add('sq', 'sq-fc');
    var info = h('p', { class: 'sq-note', text: 'Click the card or press Space to flip. Use ← → to move. Mark cards you know and study only the rest.' });
    var card = h('div', { class: 'sq-fcard', tabindex: '0', role: 'button', 'aria-label': 'Flash card. Press to flip.' });
    var faceEl = h('div', { class: 'sq-fface' }); card.appendChild(h('div', { class: 'sq-ftag' })); card.appendChild(faceEl);
    var pager = h('span', { class: 'sq-pager', 'aria-live': 'polite' });
    var prev = h('button', { type: 'button', class: 'sq-btn', html: '&laquo; Previous' });
    var next = h('button', { type: 'button', class: 'sq-btn', html: 'Next &raquo;' });
    var flip = h('button', { type: 'button', class: 'sq-btn sq-primary', text: 'Flip card' });
    var shuf = h('button', { type: 'button', class: 'sq-btn', text: 'Shuffle' });
    var knew = h('button', { type: 'button', class: 'sq-btn sq-good', text: '✓ I know this' });
    var again = h('button', { type: 'button', class: 'sq-btn', text: '↻ Still learning' });
    var faceSel = h('select', { 'aria-label': 'Default card side' }, [h('option', { value: 'term', text: 'Term first' }), h('option', { value: 'def', text: 'Definition first' })]);
    var onlyBox = h('input', { type: 'checkbox', id: 'sq-only' });
    var tally = h('span', { class: 'sq-tally' });
    var reset = h('button', { type: 'button', class: 'sq-link', text: 'Reset progress' });
    function visible() { return order.filter(function (i) { return !(onlyNew && known[terms[i][0]]); }); }
    function paint() {
      var vis = visible();
      if (!vis.length) {
        faceEl.textContent = 'You have marked every card as known. 🎉'; card.dataset.side = 'done'; pager.textContent = '0 of 0';
        $('.sq-ftag', card).textContent = 'All done';
      } else {
        if (pos >= vis.length) pos = 0; if (pos < 0) pos = vis.length - 1;
        var t = terms[vis[pos]], showTerm = faceDown ? flipped : !flipped;
        faceEl.textContent = showTerm ? t[0] : t[1];
        card.dataset.side = showTerm ? 'term' : 'def';
        $('.sq-ftag', card).textContent = showTerm ? 'TERM' : 'DEFINITION';
        card.classList.toggle('known', !!known[t[0]]);
        pager.textContent = (pos + 1) + ' of ' + vis.length;
      }
      var n = terms.filter(function (t) { return known[t[0]]; }).length;
      tally.textContent = n + ' of ' + terms.length + ' marked as known';
    }
    function go(d) { flipped = false; pos += d; paint(); }
    function mark(v) {
      var vis = visible(); if (!vis.length) return; var t = terms[vis[pos]][0];
      if (v) known[t] = 1; else delete known[t];
      update(function (o) { o.cards[ch] = known; });
      if (onlyNew && v) { flipped = false; paint(); } else go(1);
    }
    card.addEventListener('click', function () { flipped = !flipped; paint(); });
    flip.addEventListener('click', function () { flipped = !flipped; paint(); });
    prev.addEventListener('click', function () { go(-1); });
    next.addEventListener('click', function () { go(1); });
    shuf.addEventListener('click', function () { order = shuffle(order); pos = 0; flipped = false; paint(); });
    knew.addEventListener('click', function () { mark(true); });
    again.addEventListener('click', function () { mark(false); });
    faceSel.addEventListener('change', function () { faceDown = faceSel.value === 'def'; flipped = false; paint(); });
    onlyBox.addEventListener('change', function () { onlyNew = onlyBox.checked; pos = 0; flipped = false; paint(); });
    reset.addEventListener('click', function () { known = {}; update(function (o) { o.cards[ch] = {}; }); pos = 0; paint(); });
    document.addEventListener('keydown', function (e) {
      if (!mountEl.isConnected) return;
      var tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      if (e.key === 'ArrowRight') { go(1); e.preventDefault(); }
      else if (e.key === 'ArrowLeft') { go(-1); e.preventDefault(); }
      else if ((e.key === ' ' || e.key === 'Enter') && tag !== 'button' && tag !== 'a') { flipped = !flipped; paint(); e.preventDefault(); }
    });
    mountEl.appendChild(info); mountEl.appendChild(card);
    mountEl.appendChild(h('div', { class: 'sq-fnav' }, [prev, pager, next]));
    mountEl.appendChild(h('div', { class: 'sq-fnav' }, [flip, knew, again]));
    mountEl.appendChild(h('div', { class: 'sq-fopts' }, [h('label', {}, ['Start with: ', faceSel]), shuf, h('label', {}, [onlyBox, ' Only cards I haven\u2019t marked']), tally, reset]));
    paint();
  }

  /* ---------- styles ---------- */
  var CSS = [
    '.sq{--ink:#1c2b3a;--mut:#5b6b7a;--line:#d6dde4;--bg:#f6f8fa;--acc:#0e6e7e;--acc2:#0a5563;--ok:#1b7f45;--okbg:#e7f5ec;--bad:#b4342b;--badbg:#fbeceb;font-family:"Open Sans",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--ink);line-height:1.5;max-width:860px;margin:12px 0}',
    '.sq *{box-sizing:border-box}',
    '.sq-launch,.sq-card,.sq-results,.sq-review{background:#fff;border:1px solid var(--line);border-radius:10px;padding:18px 20px;margin:12px 0}',
    '.sq-status{background:var(--bg);border-radius:8px;padding:10px 12px;margin-bottom:10px;font-size:15px}',
    '.sq-note{color:var(--mut);font-size:14px;margin:8px 0 12px}',
    '.sq-field{display:inline-block;margin:6px 14px 10px 0;font-weight:600}',
    '.sq select{font:inherit;padding:6px 8px;border:1px solid #aab6c2;border-radius:6px;background:#fff;margin-left:6px}',
    '.sq-btn{font:inherit;font-weight:600;padding:9px 16px;border-radius:8px;border:1px solid #aab6c2;background:#fff;color:var(--ink);cursor:pointer;margin:4px 6px 4px 0}',
    '.sq-btn:hover{border-color:var(--acc);color:var(--acc2)}',
    '.sq-btn:focus-visible,.sq-opt:focus-within,.sq-fcard:focus-visible{outline:3px solid #f2b705;outline-offset:2px}',
    '.sq-primary{background:var(--acc);border-color:var(--acc);color:#fff}.sq-primary:hover{background:var(--acc2);color:#fff;border-color:var(--acc2)}',
    '.sq-good{background:var(--okbg);border-color:#9bd3b0;color:var(--ok)}',
    '.sq-link{background:none;border:0;color:var(--acc);text-decoration:underline;cursor:pointer;font:inherit;padding:4px 8px}',
    '.sq-head{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;font-size:14px;color:var(--mut)}',
    '.sq-bar{height:6px;background:#e3e9ef;border-radius:4px;overflow:hidden;margin:6px 0 0}.sq-bar-in{height:100%;background:var(--acc);width:0;transition:width .25s}',
    '.sq-kind{font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--mut);font-weight:700;margin-bottom:4px}',
    '.sq-prompt{font-size:16px;font-weight:600;margin:4px 0 8px}',
    '.sq-body{background:var(--bg);border-left:4px solid var(--acc);padding:12px 14px;border-radius:6px;font-size:16px;margin-bottom:12px}',
    '.sq-body-term{font-size:20px;font-weight:700}',
    '.sq-opts{display:grid;gap:8px}',
    '.sq-opt{display:flex;gap:12px;align-items:flex-start;padding:10px 12px;border:1.5px solid var(--line);border-radius:8px;cursor:pointer;background:#fff}',
    '.sq-opt:hover{border-color:var(--acc);background:#f2fafb}',
    '.sq-opt{position:relative}.sq-opt input{position:absolute;opacity:0;pointer-events:none}',
    '.sq-opt:has(input:checked){border-color:var(--acc);background:#eaf6f8}',
    '.sq-key{flex:0 0 26px;height:26px;border-radius:50%;background:#e3e9ef;text-align:center;font-weight:700;line-height:26px;font-size:13px}',
    '.sq-opt:has(input:checked) .sq-key{background:var(--acc);color:#fff}',
    '.sq-txt{flex:1;padding-top:1px}',
    '.sq .sq-opt.sq-right{border-color:var(--ok);background:var(--okbg)}.sq .sq-opt.sq-right .sq-key{background:var(--ok);color:#fff}',
    '.sq .sq-opt.sq-wrong{border-color:var(--bad);background:var(--badbg)}.sq .sq-opt.sq-wrong .sq-key{background:var(--bad);color:#fff}',
    '.sq-fb{margin-top:12px}.sq-fb:empty{display:none}',
    '.sq-verdict{font-weight:700;font-size:16px;margin-bottom:4px}',
    '.sq-fb-ok .sq-verdict{color:var(--ok)}.sq-fb-bad .sq-verdict{color:var(--bad)}',
    '.sq-explain{font-size:14.5px;color:#33434f;margin-bottom:8px}',
    '.sq-examtop{position:sticky;top:0;z-index:20;display:flex;gap:16px;flex-wrap:wrap;align-items:center;justify-content:space-between;background:#fff;border:1px solid var(--line);border-radius:10px;padding:8px 14px;box-shadow:0 2px 8px rgba(0,0,0,.06)}',
    '.sq-clock{font-variant-numeric:tabular-nums;font-weight:700}',
    '.sq-jump{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0}',
    '.sq-dot{width:32px;height:32px;line-height:30px;text-align:center;border:1.5px solid var(--line);border-radius:6px;font-size:13px;font-weight:600;color:var(--ink);text-decoration:none;background:#fff}',
    '.sq-dot.done{background:var(--acc);border-color:var(--acc);color:#fff}',
    '.sq-qcard{scroll-margin-top:70px}',
    '.sq-warn{background:#fff7dd;border:1px solid #f0d27a;border-radius:8px;padding:10px 14px;margin:10px 0;display:flex;gap:10px;align-items:center;flex-wrap:wrap}',
    '.sq-actions{margin:14px 0}',
    '.sq-score{display:inline-block;text-align:center;padding:14px 28px;border-radius:12px;margin-bottom:6px}',
    '.sq-score.good{background:var(--okbg);color:var(--ok)}.sq-score.ok{background:#fff7dd;color:#8a6500}.sq-score.low{background:var(--badbg);color:var(--bad)}',
    '.sq-pct{font-size:44px;font-weight:800;line-height:1.1}.sq-frac{font-size:14px;font-weight:600}',
    '.sq-h2{margin:0 0 8px;font-size:22px}.sq-h3{margin:20px 0 6px;font-size:18px}',
    '.sq-review{margin:10px 0;padding:14px 16px}',
    '.sq-you{color:var(--bad)}.sq-corr{color:var(--ok);margin-bottom:6px}.sq-x,.sq-ok{font-weight:700}',
    '.sq-modes{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px;margin:8px 0 14px}',
    '.sq-mode{display:flex;gap:10px;align-items:flex-start;border:1.5px solid var(--line);border-radius:8px;padding:10px 12px;cursor:pointer}',
    '.sq-mode small{display:block;color:var(--mut)}.sq-mode:has(input:checked){border-color:var(--acc);background:#eaf6f8}',
    '.sq-chs{border:1px solid var(--line);border-radius:8px;padding:8px 12px;margin:8px 0}.sq-chs legend{font-size:14px;font-weight:700;width:auto;padding:0 6px;margin:0;border:0}',
    '.sq-chgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:2px 14px}',
    '.sq-ch{display:flex;gap:8px;align-items:flex-start;font-size:14px;padding:3px 0;cursor:pointer}',
    /* flash cards */
    '.sq-fcard{position:relative;min-height:230px;display:flex;align-items:center;justify-content:center;text-align:center;padding:34px 28px 26px;background:#fff;border:2px solid var(--line);border-radius:14px;cursor:pointer;box-shadow:0 4px 14px rgba(20,40,60,.07);margin:10px 0;transition:background .15s}',
    '.sq-fcard[data-side=def]{background:#f2fafb;border-color:#9fd0d8}.sq-fcard.known{border-color:#9bd3b0}',
    '.sq-fface{font-size:20px;line-height:1.45}.sq-fcard[data-side=term] .sq-fface{font-size:28px;font-weight:700}',
    '.sq-ftag{position:absolute;top:10px;left:14px;font-size:11px;letter-spacing:.1em;color:var(--mut);font-weight:700}',
    '.sq-fnav,.sq-fopts{display:flex;gap:8px;align-items:center;justify-content:center;flex-wrap:wrap;margin:6px 0}',
    '.sq-fopts{justify-content:flex-start;gap:14px;font-size:14px;margin-top:14px}.sq-pager{min-width:80px;text-align:center;font-weight:600}',
    '.sq-tally{color:var(--mut);margin-left:auto}',
    /* injected chrome on course pages */
    '#scat-home{position:fixed;left:14px;bottom:14px;z-index:9999;background:#0e6e7e;color:#fff;font:600 14px "Open Sans",system-ui,sans-serif;padding:9px 14px;border-radius:22px;text-decoration:none;box-shadow:0 3px 10px rgba(0,0,0,.25)}',
    '#scat-home:hover{background:#0a5563;color:#fff;text-decoration:none}',
    '.scat-saved{display:inline-block;margin-left:10px;color:#1b7f45;font-weight:600}',
    '.scat-localnote{background:#fff7dd;border:1px solid #f0d27a;border-radius:8px;padding:8px 12px;margin:8px 0;font-size:14px}',
    '@media(max-width:700px){#scat-home{left:auto;right:12px;bottom:12px;width:42px;height:42px;padding:0;font-size:0;line-height:42px;text-align:center;border-radius:50%;opacity:.92}#scat-home::before{content:"\\2630";font-size:19px}}',
    '@media(max-width:600px){.sq-launch,.sq-card,.sq-results{padding:14px}.sq-fface{font-size:18px}}'
  ].join('\n');
  function injectCSS() {
    if ($('#sq-style')) return;
    var s = h('style', { id: 'sq-style' }); s.textContent = CSS; document.head.appendChild(s);
  }

  /* ---------- course-page enhancements ---------- */
  function fileName() { return decodeURIComponent(location.pathname.split('/').pop() || ''); }
  function enhancePage() {
    var file = fileName();
    var m = file.match(/^chapter(\d+)/);
    var ch = m ? +m[1] : null;

    // progress: remember visited pages
    update(function (o) { o.visited[file] = Date.now(); o.last = file; });

    // floating link back to the index
    var home = h('a', { id: 'scat-home', href: ROOT + 'index.html', text: '☰ Index', title: 'Course index (all chapters)' });
    document.body.appendChild(home);
    var rootNav = $('.root_nav_items');
    if (rootNav) {
      var li = h('li', { class: 'root_nav_item' }, [h('a', { href: ROOT + 'index.html', text: 'Index' })]);
      rootNav.insertBefore(li, rootNav.firstChild);
    }

    // top-bar links that only make sense on the live server
    $$('#top_menu_navigation a').forEach(function (a) {
      var href = a.getAttribute('href') || '', label = (a.textContent || '').trim();
      var li = a.closest('li') || a;
      if (/pescirrus\.com\/\/?(manageAccount|changePassword|messages|user\/logout|systemHelp)/.test(href)) { li.style.display = 'none'; }
      else if (/pescirrus\.com\/?$/.test(href)) { a.setAttribute('href', ROOT + 'index.html'); }
      else if (label === 'Print') { a.setAttribute('href', '#'); a.addEventListener('click', function (e) { e.preventDefault(); window.print(); }); }
    });

    // controls that needed Drupal/Bootstrap JS
    window.mobileMenuBtn = function () { var e = $('#bs-example-navbar-collapse-1'); if (e) e.classList.toggle('in'); };
    $$('.navbar-toggle').forEach(function (b) {
      if (b.id === 'mobile_menu_btn') return;
      b.addEventListener('click', function () { var t = $(b.getAttribute('data-target')); if (t) t.classList.toggle('in'); });
    });
    $$('.dropdown-toggle').forEach(function (b) {
      b.addEventListener('click', function (e) { e.preventDefault(); if (b.parentNode) b.parentNode.classList.toggle('open'); });
    });
    var trial = $('.trial_access_notification .close');
    if (trial) trial.addEventListener('click', function () { var t = $('.trial_access_notification'); if (t) t.style.display = 'none'; });

    // course search box -> index search
    var sf = $('#webcom-course-search-form');
    if (sf) sf.addEventListener('submit', function (e) {
      e.preventDefault(); var v = $('#search', sf); location.href = ROOT + 'index.html?q=' + encodeURIComponent(v ? v.value : '');
    });

    // assessments served by the (offline) LMS -> local quizzes
    $$('.public_view_assessment').forEach(function (comp) {
      var link = $('a[href*="launch-assessment"]', comp);
      if (!link || !ch) return;
      var title = ($('.page_component_title', comp) || {}).textContent || 'Quiz';
      var cfg;
      if (/exam\.html$/.test(file)) cfg = { mode: 'exam', count: 25, label: 'Chapter ' + ch + ' Exam' };
      else if (/practice\.html$/.test(file)) cfg = { mode: 'practice', count: 20, label: 'Chapter ' + ch + ' Practice Test' };
      else if (/reviewandassessment\.html$/.test(file)) cfg = { mode: 'practice', count: 10, fixed: true, label: 'Chapter ' + ch + ' Check Your Understanding' };
      else cfg = { mode: 'practice', count: 5, fixed: true, label: title.trim() };
      cfg.chs = [ch]; cfg.key = 'ch' + ch + ':' + file.replace(/\.html$/, '') + ':' + cfg.label;
      var body = $('.page_component_body', comp);
      if (!body) return;
      body.innerHTML = '';
      var host = h('div', { class: 'sq' }); body.appendChild(host);
      launcher(host, cfg);
    });

    // flash cards
    var gl = $('.public_view_glossary .glossary');
    if (gl && ch) {
      var dj = $('script[data-drupal-selector="drupal-settings-json"]'), terms = (D.gloss[ch] || []);
      var mountEl = h('div'); gl.innerHTML = ''; gl.appendChild(mountEl);
      flashcards(mountEl, terms, ch);
    }

    // short-answer worksheets: save on this device instead of posting to the LMS
    $$('form.uniForm').forEach(function (f, fi) {
      f.setAttribute('action', 'javascript:void(0)');
      $$('.filter-wrapper', f).forEach(function (x) { x.style.display = 'none'; });
      var tas = $$('textarea', f);
      var saved = readDB().notes;
      tas.forEach(function (ta, k) {
        var nk = file + '#' + fi + '.' + k;
        if (saved[nk]) ta.value = saved[nk];
        var t; ta.addEventListener('input', function () {
          clearTimeout(t); t = setTimeout(function () { update(function (o) { o.notes[nk] = ta.value; }); flash(); }, 400);
        });
      });
      var note;
      function flash() {
        if (!note) { note = h('span', { class: 'scat-saved' }); var b = $('input[type=submit]', f); if (b && b.parentNode) b.parentNode.appendChild(note); else f.appendChild(note); }
        note.textContent = '✓ Saved on this device'; clearTimeout(note._t); note._t = setTimeout(function () { note.textContent = ''; }, 2500);
      }
      f.addEventListener('submit', function (e) {
        e.preventDefault();
        tas.forEach(function (ta, k) { var nk = file + '#' + fi + '.' + k; update(function (o) { o.notes[nk] = ta.value; }); });
        flash();
      });
      var hint = h('div', { class: 'scat-localnote', text: 'Offline copy: your answers are saved in this browser only and are not sent to an instructor.' });
      f.insertBefore(hint, f.firstChild);
    });

    // keyboard page navigation (←/→) on pages that don't use those keys
    if (!gl && !$('.sq')) {
      document.addEventListener('keydown', function (e) {
        if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
        var tag = (e.target.tagName || '').toLowerCase();
        if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable) return;
        var a = e.key === 'ArrowRight' ? $('#next_prev_nav_next a') : e.key === 'ArrowLeft' ? $('#next_prev_nav_prev a') : null;
        if (a) location.href = a.href;
      });
    }
  }

  window.SCATLIB = {
    readDB: readDB, update: update, makeQuestions: makeQuestions, launcher: launcher, chooser: chooser,
    flashcards: flashcards, injectCSS: injectCSS, ROOT: ROOT, fmtDate: fmtDate, attemptsFor: attemptsFor, pct: pct
  };
  injectCSS();
  function boot() { if (document.body && /path-webcom-view-page/.test(document.body.className)) enhancePage(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
