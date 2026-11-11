// PLaMo 3 Translate Local — page translator (injected on demand).
// Finds runs of inline content, serializes inline elements as <xN>…</xN> placeholders
// (PLaMo 3 Translate keeps such tags), translates lazily as content scrolls into view,
// and puts the translation back while reusing the original elements (links keep working).

(() => {
  if (window.__plamoPage) return;
  const api = (window.__plamoPage = {});

  // ---------------------------------------------------------------- constants
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION', 'OPTGROUP',
    'PRE', 'SVG', 'MATH', 'CANVAS', 'VIDEO', 'AUDIO', 'IFRAME', 'OBJECT', 'EMBED', 'HEAD', 'TITLE', 'META', 'LINK',
    'BASE', 'PLAMO-T', 'PLAMO-UI']);
  const INLINE = new Set(['A', 'ABBR', 'B', 'BDI', 'BDO', 'BIG', 'BUTTON', 'CITE', 'DATA', 'DEL', 'DFN', 'EM', 'FONT', 'I',
    'INS', 'LABEL', 'MARK', 'NOBR', 'Q', 'RUBY', 'S', 'SMALL', 'SPAN', 'STRIKE', 'STRONG', 'SUB', 'SUP', 'TIME', 'TT', 'U']);
  const KEEP = new Set(['CODE', 'KBD', 'SAMP', 'VAR']);
  const ATOMIC = new Set(['IMG', 'PICTURE', 'SVG', 'MATH', 'CANVAS', 'VIDEO', 'AUDIO', 'IFRAME', 'INPUT', 'SELECT',
    'TEXTAREA', 'OBJECT', 'EMBED', 'WBR', 'METER', 'PROGRESS', 'OUTPUT']);
  const INTERACTIVE = new Set(['A', 'BUTTON', 'LABEL']);
  const BLOCK_SEL = 'address,article,aside,blockquote,details,dialog,dd,div,dl,dt,fieldset,figcaption,figure,footer,form,' +
    'h1,h2,h3,h4,h5,h6,header,hgroup,hr,li,main,nav,ol,p,pre,section,summary,table,tbody,thead,tfoot,tr,td,th,ul,menu';
  const TAG_RE = /<(\/?)x(\d+)(\/?)>/g;
  // = engine slots: keeping more in flight would commit to an order (in the background queue)
  // before all visible units are known; each pick happens when a slot frees up instead
  const MAX_OUTSTANDING = 8;

  // ---------------------------------------------------------------- state
  const S = {
    active: false,
    mode: 'replace',
    target: 'ja',
    altTarget: 'en',
    context: '',
    units: [],            // all units created in this session
    waiting: [],          // units ready to be requested (visible)
    inflight: new Map(),  // id -> unit
    seq: 0,
    done: 0,
    failed: 0,
    paused: null,         // error payload when paused (model missing / failed to load)
    offer: null,          // {lang, from, to, skipped} while the pill offers to translate (autoPage 'ask')
    port: null,
    io: null,
    mo: null,
    anchorUnits: new Map(), // element -> units waiting for visibility
    dirty: new Set(),
    scanTimer: 0,
  };
  const processedText = new WeakSet(); // text nodes that belong to a unit (or that we created)
  const ownNodes = new WeakSet();      // nodes we inserted
  let blockCache = new WeakMap();
  let displayCache = new WeakMap();

  // ---------------------------------------------------------------- helpers
  const isJa = (t) => {
    let kana = 0, han = 0, other = 0;
    for (const ch of t) {
      const cp = ch.codePointAt(0);
      if ((cp >= 0x3040 && cp <= 0x30ff) || (cp >= 0xff66 && cp <= 0xff9f)) kana++;
      else if (cp >= 0x4e00 && cp <= 0x9fff) han++;
      else if (/\p{L}/u.test(ch)) other++;
    }
    if (!kana) return false;
    return (kana + han) / (kana + han + other) >= 0.25;
  };
  const normWS = (s) => s.replace(/[ \t\n\r\f]+/g, ' ');
  const meaningful = (t) => {
    const s = t.trim();
    if (!s) return false;
    if (!/\p{L}/u.test(s)) return false; // numbers, symbols only
    if (!/\s/.test(s) && /^[\w\-.\/:@#%?=&+~]+$/.test(s) && /[\/._:@=]/.test(s)) return false; // URL / identifier
    return true;
  };
  const noTranslate = (el) =>
    el.getAttribute('translate') === 'no' || el.classList.contains('notranslate') || el.isContentEditable;

  // Link text identical to its URL's last path segment or a query value is a name
  // (file / directory / user / tag), e.g. GitHub's file list: <a href=".../tree/master/docs">docs</a>.
  function isNameLink(a, text) {
    const t = text.trim();
    if (!t || t.length > 80 || !a.href) return false;
    let u;
    try {
      u = new URL(a.href);
    } catch {
      return false;
    }
    let seg = u.pathname.replace(/\/+$/, '').split('/').pop() || '';
    try {
      seg = decodeURIComponent(seg);
    } catch {}
    if (seg && seg === t) return true;
    for (const v of u.searchParams.values()) if (v === t) return true;
    return false;
  }

  function hasBlockDescendant(el) {
    let v = blockCache.get(el);
    if (v === undefined) {
      v = !!el.querySelector(BLOCK_SEL);
      blockCache.set(el, v);
    }
    return v;
  }

  // Is this child node part of an inline run?
  function isInlineNode(n) {
    if (n.nodeType === Node.TEXT_NODE) return true;
    if (n.nodeType !== Node.ELEMENT_NODE) return false;
    const t = n.tagName;
    if (t === 'BR' || KEEP.has(t) || ATOMIC.has(t)) return true;
    if (INLINE.has(t)) return !hasBlockDescendant(n);
    if (t.includes('-')) {
      // custom elements (e.g. <relative-time>): inline when the page renders them inline
      let d = displayCache.get(n);
      if (d === undefined) {
        try {
          d = getComputedStyle(n).display;
        } catch {
          d = 'block';
        }
        displayCache.set(n, d);
      }
      return d.startsWith('inline') && !hasBlockDescendant(n);
    }
    return false;
  }

  // text that would actually be translated (code / notranslate content excluded)
  function translatableText(nodes) {
    let s = '';
    const walk = (n) => {
      if (n.nodeType === Node.TEXT_NODE) s += n.nodeValue;
      else if (n.nodeType === Node.ELEMENT_NODE && !KEEP.has(n.tagName) && !noTranslate(n) && !SKIP.has(n.tagName))
        for (const c of n.childNodes) walk(c);
    };
    nodes.forEach(walk);
    return s;
  }

  function textOf(nodes) {
    let s = '';
    for (const n of nodes) s += n.textContent || '';
    return s;
  }

  function textNodesIn(nodes) {
    const out = [];
    for (const n of nodes) {
      if (n.nodeType === Node.TEXT_NODE) out.push(n);
      else if (n.nodeType === Node.ELEMENT_NODE) {
        const w = document.createTreeWalker(n, NodeFilter.SHOW_TEXT);
        for (let t = w.nextNode(); t; t = w.nextNode()) out.push(t);
      }
    }
    return out;
  }

  const isEdgeJunk = (n) =>
    (n.nodeType === Node.TEXT_NODE && !n.nodeValue.trim()) ||
    (n.nodeType === Node.ELEMENT_NODE && (ATOMIC.has(n.tagName) || n.tagName === 'BR' || (!KEEP.has(n.tagName) && !n.textContent.trim()))) ||
    n.nodeType === Node.COMMENT_NODE;

  // ---------------------------------------------------------------- scanning
  function scan(root) {
    const found = [];
    const visit = (el) => {
      if (!el || SKIP.has(el.tagName) || ownNodes.has(el)) return;
      if (el.nodeType === Node.ELEMENT_NODE && noTranslate(el)) return;
      if (el.shadowRoot) {
        visit(el.shadowRoot);
        S.mo?.observe(el.shadowRoot, { childList: true, subtree: true });
      }
      // Inline elements are handled by their block ancestor unless they contain blocks.
      const container = el.nodeType === Node.DOCUMENT_FRAGMENT_NODE || !isInlineNode(el);
      if (container) collectRuns(el, found);
      for (const c of el.children || []) visit(c);
    };
    visit(root);
    return found;
  }

  function collectRuns(parent, found) {
    let run = [];
    const flush = () => {
      if (run.length) makeUnit(parent, run, found);
      run = [];
    };
    for (const n of parent.childNodes) {
      if (ownNodes.has(n)) {
        flush();
        continue;
      }
      if (isInlineNode(n) || n.nodeType === Node.COMMENT_NODE) run.push(n);
      else flush();
    }
    flush();
  }

  function makeUnit(parent, run, found) {
    // trim icons / whitespace at the edges; they stay where they are
    let a = 0, b = run.length;
    while (a < b && isEdgeJunk(run[a])) a++;
    while (b > a && isEdgeJunk(run[b - 1])) b--;
    let nodes = run.slice(a, b);
    // a run that is just one inline element: descend into it (fewer tags)
    while (
      nodes.length === 1 &&
      nodes[0].nodeType === Node.ELEMENT_NODE &&
      INLINE.has(nodes[0].tagName) &&
      !noTranslate(nodes[0])
    ) {
      parent = nodes[0];
      const kids = [...parent.childNodes];
      a = 0;
      b = kids.length;
      while (a < b && isEdgeJunk(kids[a])) a++;
      while (b > a && isEdgeJunk(kids[b - 1])) b--;
      nodes = kids.slice(a, b);
    }
    if (!nodes.length) return;
    // nav bars / tag lists: several links separated only by spaces or symbols -> one unit per link
    const topEls = nodes.filter((n) => n.nodeType === Node.ELEMENT_NODE);
    if (topEls.length >= 2 && topEls.every((e) => INTERACTIVE.has(e.tagName) || !e.textContent.trim())) {
      const outside = nodes.filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.nodeValue).join('');
      if (!/\p{L}/u.test(outside)) {
        for (const e of topEls) if (e.textContent.trim()) makeUnit(parent, [e], found);
        return;
      }
    }
    const tns = textNodesIn(nodes);
    if (!tns.length || tns.some((t) => processedText.has(t))) return;
    if (!meaningful(translatableText(nodes))) return;
    const link =
      parent.nodeType === Node.ELEMENT_NODE && parent.tagName === 'A'
        ? parent
        : nodes.length === 1 && nodes[0].nodeType === Node.ELEMENT_NODE && nodes[0].tagName === 'A'
          ? nodes[0]
          : null;
    if (link && isNameLink(link, textOf(nodes))) return;
    if (parent.nodeType === Node.ELEMENT_NODE && parent.closest('[contenteditable=""],[contenteditable="true"],plamo-ui,pre')) return;
    const unit = { parent, nodes, state: 'new' };
    if (!serialize(unit)) return;
    for (const t of tns) processedText.add(t);
    found.push(unit);
  }

  function serialize(unit) {
    const map = [];
    let out = '';
    const walk = (node, parentIdx, first) => {
      if (node.nodeType === Node.TEXT_NODE) {
        out += normWS(node.nodeValue);
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const tag = node.tagName;
      if (tag === 'BR') {
        out += '\n';
        return;
      }
      if (tag === 'RT' || tag === 'RP') return;
      const hasText = !!node.textContent.trim();
      // No letters at all ("[1]", "2017", "→"): one opaque placeholder, element kept as is.
      // Wikipedia's "[1]" alone is five nested inline elements, i.e. ~40 tokens the model has
      // to read and echo per citation, which made such paragraphs ~5x slower to translate.
      const noLetters = hasText && !/\p{L}/u.test(node.textContent);
      if (ATOMIC.has(tag) || SKIP.has(tag) || (!hasText && !KEEP.has(tag)) || noLetters) {
        const i = map.push({ node, kind: 'atomic', parentIdx, first }) - 1;
        out += `<x${i}/>`;
        return;
      }
      if (KEEP.has(tag) || noTranslate(node)) {
        const i = map.push({ node, kind: 'keep', parentIdx, required: INTERACTIVE.has(tag) }) - 1;
        out += `<x${i}>${normWS(node.textContent)}</x${i}>`;
        return;
      }
      const i = map.push({ node, kind: 'el', parentIdx, required: INTERACTIVE.has(tag) }) - 1;
      out += `<x${i}>`;
      let f = true;
      for (const c of node.childNodes) {
        walk(c, i, f);
        if (c.nodeType === Node.TEXT_NODE ? c.nodeValue.trim() : c.nodeType === Node.ELEMENT_NODE) f = false;
      }
      out += `</x${i}>`;
    };
    let f = true;
    for (const n of unit.nodes) {
      walk(n, -1, f);
      f = false;
    }
    const lead = /^\s/.test(out) ? ' ' : '';
    const trail = /\s$/.test(out) ? ' ' : '';
    out = out.replace(/ *\n */g, '\n').trim();
    // literal "<x1>" in the page text would confuse the parser: translate as plain text then
    const literal = textOf(unit.nodes).match(/<\/?x\d+\/?>/);
    if (literal) {
      unit.src = normWS(textOf(unit.nodes)).trim();
      unit.map = [];
    } else {
      unit.src = out;
      unit.map = map;
    }
    unit.lead = lead;
    unit.trail = trail;
    if (unit.src.length > 8000) return false;
    return !!unit.src;
  }

  // ---------------------------------------------------------------- parsing model output
  function parse(out, unit) {
    const root = { children: [] };
    const stack = [root];
    const used = new Set();
    let last = 0;
    let m;
    TAG_RE.lastIndex = 0;
    while ((m = TAG_RE.exec(out))) {
      if (m.index > last) stack[stack.length - 1].children.push({ text: out.slice(last, m.index) });
      last = TAG_RE.lastIndex;
      const idx = +m[2];
      const info = unit.map[idx];
      if (!info) return null;
      const top = stack[stack.length - 1];
      if (m[1]) {
        if (top.idx !== idx) return null;
        stack.pop();
        continue;
      }
      if (used.has(idx)) return null;
      used.add(idx);
      const node = { idx, children: [] };
      top.children.push(node);
      if (!m[3] && info.kind !== 'atomic') stack.push(node);
      else if (!m[3] && info.kind === 'atomic') {
        // "<x3></x3>" for an atomic element: swallow until its closing tag
        const close = out.indexOf(`</x${idx}>`, last);
        if (close >= 0) {
          last = close + `</x${idx}>`.length;
          TAG_RE.lastIndex = last;
        }
      }
    }
    if (last < out.length) stack[stack.length - 1].children.push({ text: out.slice(last) });
    if (stack.length !== 1) return null;
    for (let i = 0; i < unit.map.length; i++) if (!used.has(i) && unit.map[i].required) return null;
    return { root, used };
  }

  const stripTags = (s) => s.replace(/<\/?x\d+\/?>/g, '');

  // A translation whose tags do not parse (the model left a tag open or closed the wrong one) would put the
  // whole paragraph in 併記. Repair it from the source's structure instead:
  //  - an element the model never closes ends where the output leaves it: at a tag that cannot be inside it
  //    in the source, at a closing tag with a wrong number, or at the end of the output; when it ends at a
  //    tag or at the end, the words after its last child stay inside only up to the first clause punctuation
  //    (an element that wraps the rest of the source keeps everything up to the end)
  //  - a tag the source does not have is dropped; a second use of a tag keeps its words, not the tag
  //  - a closing tag for an element the output never opened (the model gave its opening tag another number)
  //    takes the words just before it
  //  - a link left empty (the model put its tag after its words) takes the words just before it
  // A link missing from the output still means 併記: links are never lost.
  const CLAUSE = /[、。，．！？）」』】〕〉》]|[,.;:!?)\]](?=\s|$)/;
  const CLAUSE_G = new RegExp(CLAUSE.source, 'g');
  // where the words at the end of s begin: after its last clause punctuation and the spaces after it
  const lastWords = (s) => {
    let cut = 0;
    CLAUSE_G.lastIndex = 0;
    for (let x; (x = CLAUSE_G.exec(s)); ) cut = x.index + x[0].length;
    return cut + s.slice(cut).match(/^\s*/)[0].length;
  };
  function repairParse(out, unit) {
    const map = unit.map;
    const within = (a, b) => {
      if (a < 0) return true;
      for (let p = map[b].parentIdx; p >= 0; p = map[p].parentIdx) if (p === a) return true;
      return false;
    };
    const toks = [];
    let last = 0;
    let m;
    TAG_RE.lastIndex = 0;
    while ((m = TAG_RE.exec(out))) {
      if (m.index > last) toks.push({ text: out.slice(last, m.index) });
      toks.push({ idx: +m[2], close: !!m[1], self: !!m[3] });
      last = TAG_RE.lastIndex;
    }
    if (last < out.length) toks.push({ text: out.slice(last) });
    const lastClose = new Map();
    toks.forEach((t, i) => t.close && lastClose.set(t.idx, i));
    const toEnd = new Set();
    for (let i = 0; i < map.length; i++) {
      const c = unit.src.indexOf(`</x${i}>`);
      if (c >= 0 && !unit.src.slice(c).replace(/<\/?x\d+\/?>|\s/g, '')) toEnd.add(i);
    }
    const root = { idx: -1, children: [] };
    const stack = [root];
    const used = new Set();
    const top = () => stack[stack.length - 1];
    const neverClosed = (n) => n.idx >= 0 && !((lastClose.get(n.idx) ?? -1) > n.at);
    const closeLeftOpen = (atEnd) => {
      const n = stack.pop();
      if (atEnd && toEnd.has(n.idx)) return;
      const tail = n.children[n.children.length - 1];
      if (tail?.text === undefined) return;
      const c = CLAUSE.exec(tail.text);
      if (!c || (!c.index && n.children.length === 1)) return;
      const rest = tail.text.slice(c.index);
      if (c.index) tail.text = tail.text.slice(0, c.index);
      else n.children.pop();
      top().children.push({ text: rest });
    };
    for (let t = 0; t < toks.length; t++) {
      const tok = toks[t];
      if (tok.text !== undefined) {
        top().children.push({ text: tok.text });
        continue;
      }
      const info = map[tok.idx];
      if (!info) continue;
      if (tok.close) {
        const at = stack.findLastIndex((n) => n.idx === tok.idx);
        if (at > 0) {
          while (stack.length - 1 > at) closeLeftOpen(false);
          stack.pop();
        } else if (neverClosed(top())) stack.pop();
        else if (!used.has(tok.idx) && info.kind === 'el') {
          const kids = top().children;
          const tail = kids[kids.length - 1];
          const cut = tail?.text !== undefined ? lastWords(tail.text) : -1;
          if (cut >= 0 && tail.text.slice(cut).trim()) {
            used.add(tok.idx);
            kids.push({ idx: tok.idx, children: [{ text: tail.text.slice(cut) }], at: t });
            tail.text = tail.text.slice(0, cut);
          }
        }
        continue;
      }
      while (stack.length > 1 && neverClosed(top()) && !within(top().idx, tok.idx)) closeLeftOpen(false);
      const node = { idx: tok.idx, children: [], at: t };
      if (used.has(tok.idx)) node.dup = true;
      else used.add(tok.idx);
      if (!node.dup || (!tok.self && info.kind !== 'atomic')) top().children.push(node);
      if (tok.self) continue;
      if (info.kind === 'atomic') {
        const c = toks.findIndex((x, i) => i > t && x.close && x.idx === tok.idx);
        if (c > 0) t = c;
        continue;
      }
      stack.push(node);
    }
    while (stack.length > 1) closeLeftOpen(true);
    const flat = (n) => {
      const kids = [];
      for (const c of n.children) {
        if (c.text !== undefined) kids.push(c);
        else if (c.dup) kids.push(...flat(c).children);
        else kids.push(flat(c));
      }
      n.children = kids;
      return n;
    };
    flat(root);
    for (let i = 0; i < map.length; i++) if (!used.has(i) && map[i].required) return null;
    const hasText = (n) => (n.text !== undefined ? !!n.text.trim() : n.children.some(hasText));
    const isEmptyLink = (c) => c.text === undefined && map[c.idx].required && map[c.idx].kind === 'el' && !hasText(c);
    const fill = (n) => {
      n.children.forEach((c, k) => {
        if (c.text !== undefined) return;
        fill(c);
        if (!isEmptyLink(c)) return;
        const prev = n.children[k - 1];
        if (prev?.text !== undefined) {
          const cut = lastWords(prev.text);
          const words = prev.text.slice(cut);
          if (words.trim()) {
            prev.text = prev.text.slice(0, cut);
            c.children.push({ text: words });
            return;
          }
        }
        const next = n.children[k + 1];
        if (next?.text !== undefined) {
          const x = CLAUSE.exec(next.text);
          const words = x ? next.text.slice(0, x.index) : next.text;
          if (words.trim()) {
            next.text = next.text.slice(words.length);
            c.children.push({ text: words });
          }
        }
      });
    };
    fill(root);
    const anyEmpty = (n) => n.children.some((c) => c.text === undefined && (isEmptyLink(c) || anyEmpty(c)));
    if (anyEmpty(root)) return null;
    return { root, used };
  }

  // ---------------------------------------------------------------- building DOM
  function own(n) {
    ownNodes.add(n);
    if (n.nodeType === Node.TEXT_NODE) processedText.add(n);
    return n;
  }

  function appendText(parent, text) {
    const parts = text.split('\n');
    parts.forEach((p, i) => {
      if (i > 0) parent.appendChild(own(document.createElement('br')));
      if (p) parent.appendChild(own(document.createTextNode(p)));
    });
  }

  // clone=false: reuse original elements (replace mode). clone=true: copies (bilingual mode).
  function buildInto(container, parsed, unit, clone) {
    const placeAtom = (m, into) => {
      const n = clone ? m.node.cloneNode(true) : m.node;
      if (clone && n.removeAttribute) n.removeAttribute('id');
      into.appendChild(n);
      return n;
    };
    const elFor = new Map(); // idx -> element used in output
    const rec = (children, into) => {
      for (const c of children) {
        if (c.text !== undefined) {
          appendText(into, c.text);
          continue;
        }
        const m = unit.map[c.idx];
        if (m.kind === 'el') {
          let el;
          if (clone) {
            el = m.node.cloneNode(false);
            if (el.removeAttribute) el.removeAttribute('id');
            own(el);
          } else {
            el = m.node;
            el.replaceChildren();
          }
          elFor.set(c.idx, el);
          rec(c.children, el);
          into.appendChild(el);
        } else {
          elFor.set(c.idx, placeAtom(m, into));
        }
      }
    };
    rec(parsed.root.children, container);
    // atomic elements the model dropped (icons, images): put them back at their side
    unit.map.forEach((m, i) => {
      if (parsed.used.has(i) || m.kind !== 'atomic') return;
      const into = m.parentIdx < 0 ? container : elFor.get(m.parentIdx);
      if (!into) return;
      const n = clone ? m.node.cloneNode(true) : m.node;
      if (m.first) into.insertBefore(n, into.firstChild);
      else into.appendChild(n);
    });
  }

  function attached(unit) {
    return unit.nodes.every((n) => n.parentNode === unit.parent);
  }

  function apply(unit) {
    if (unit.applied || unit.translation == null) return;
    if (!attached(unit)) {
      unit.state = 'stale';
      return;
    }
    const out = unit.translation;
    const hasEls = unit.nodes.some((n) => n.nodeType === Node.ELEMENT_NODE && n.tagName !== 'BR');
    let parsed = null;
    unit.repaired = false;
    if (unit.map.length) {
      parsed = parse(out, unit);
      if (!parsed) {
        parsed = repairParse(out, unit);
        unit.repaired = !!parsed;
      }
    } else if (!hasEls) parsed = { root: { children: [{ text: out }] }, used: new Set() };
    const mode = parsed ? S.mode : 'bilingual'; // a link the translation lost: never break links, show below instead
    const tree = parsed || { root: { children: [{ text: stripTags(out) }] }, used: new Set() };
    unit.renderMode = mode;
    unit.fallback = !parsed;

    if (mode === 'replace') {
      // simplest & safest case: a single text node -> just swap its value
      if (unit.nodes.length === 1 && unit.nodes[0].nodeType === Node.TEXT_NODE && !out.includes('\n')) {
        const tn = unit.nodes[0];
        unit.origValue = tn.nodeValue;
        const lead = tn.nodeValue.match(/^\s*/)[0];
        const trail = tn.nodeValue.match(/\s*$/)[0];
        tn.nodeValue = (lead ? ' ' : '') + out.trim() + (trail ? ' ' : '');
        unit.applied = 'value';
        return;
      }
      // comment nodes stay where they are: frameworks (Vue, Svelte…) use them as anchors
      unit.origTop = unit.nodes.filter((n) => n.nodeType !== Node.COMMENT_NODE);
      unit.origChildren = new Map();
      for (const m of unit.map) if (m.kind === 'el') unit.origChildren.set(m.node, [...m.node.childNodes]);
      const marker = own(document.createComment('plamo'));
      unit.parent.insertBefore(marker, unit.nodes[0]);
      for (const n of unit.origTop) n.remove();
      const frag = document.createDocumentFragment();
      if (unit.lead) frag.appendChild(own(document.createTextNode(' ')));
      buildInto(frag, tree, unit, false);
      if (unit.trail) frag.appendChild(own(document.createTextNode(' ')));
      // elements the model dropped: re-attach nothing (their text is part of the translation)
      unit.translatedTop = [...frag.childNodes];
      unit.parent.insertBefore(frag, marker);
      marker.remove();
      unit.applied = 'replace';
    } else {
      const wrap = own(document.createElement('plamo-t'));
      wrap.setAttribute('lang', S.target);
      styleWrapper(wrap, unit);
      buildInto(wrap, tree, unit, true);
      const last = unit.nodes[unit.nodes.length - 1];
      unit.parent.insertBefore(wrap, last.nextSibling);
      unit.wrapper = wrap;
      unit.applied = 'bilingual';
    }
  }

  function styleWrapper(wrap, unit) {
    const p = unit.parent.nodeType === Node.ELEMENT_NODE ? unit.parent : unit.parent.host || document.body;
    let display = 'block';
    try {
      display = getComputedStyle(p).display;
    } catch {}
    const text = textOf(unit.nodes).trim();
    const inlineCtx = /inline/.test(display) || INLINE.has(p.tagName);
    const short = text.length < 18 && !/[.!?。]\s*$/.test(text);
    if (inlineCtx || short) {
      wrap.style.cssText = 'display:inline;margin-inline-start:.4em;';
    } else {
      wrap.style.cssText = 'display:block;margin-top:.3em;';
    }
    wrap.dataset.kind = inlineCtx || short ? 'inline' : 'block';
  }

  function restore(unit) {
    if (!unit.applied) return;
    try {
      if (unit.applied === 'value') {
        if (unit.nodes[0].nodeValue !== unit.origValue) unit.nodes[0].nodeValue = unit.origValue;
      } else if (unit.applied === 'replace') {
        const anchor = unit.translatedTop.find((n) => n.parentNode === unit.parent);
        if (anchor) {
          const marker = document.createComment('plamo');
          unit.parent.insertBefore(marker, anchor);
          for (const n of unit.translatedTop) if (n.parentNode === unit.parent) n.remove();
          // empty them all first: when the translation nested them the other way round (<a><i>…</i></a> for
          // <i><a>…</a></i>), putting one back into the other would make an element its own ancestor
          for (const el of unit.origChildren.keys()) el.replaceChildren();
          for (const [el, kids] of unit.origChildren) el.replaceChildren(...kids);
          const frag = document.createDocumentFragment();
          for (const n of unit.origTop) frag.appendChild(n);
          unit.parent.insertBefore(frag, marker);
          marker.remove();
        }
      } else if (unit.applied === 'bilingual') {
        unit.wrapper?.remove();
        unit.wrapper = null;
      }
    } catch (e) {
      console.debug('[PLaMo] restore failed', e);
    }
    unit.applied = null;
  }

  // ---------------------------------------------------------------- requests
  function getPort() {
    if (S.port) return S.port;
    const port = chrome.runtime.connect({ name: 'page' });
    port.onMessage.addListener(onResult);
    port.onDisconnect.addListener(() => {
      if (S.port !== port) return;
      S.port = null;
      // service worker went away: requeue what was in flight
      for (const unit of S.inflight.values()) {
        unit.state = 'waiting';
        S.waiting.push(unit);
      }
      S.inflight.clear();
      glow.clear();
      if (S.active) setTimeout(pump, 300);
    });
    S.port = port;
    return port;
  }

  function enqueue(unit) {
    if (unit.state !== 'new') return;
    const t = textOf(unit.nodes);
    const already =
      S.target === 'ja' || S.target === 'ja(easy)'
        ? isJa(t)
        : S.target === 'en'
          ? !/[^\u0000-\u024f\u2000-\u206f\u20a0-\u20cf\u2100-\u214f]/.test(t) // Latin only: English (or a name)
          : false;
    if (already) {
      unit.state = 'skip';
      return;
    }
    unit.state = 'waiting';
    S.waiting.push(unit);
  }

  function distance(unit) {
    const el = unit.parent.nodeType === Node.ELEMENT_NODE ? unit.parent : unit.parent.host;
    if (!el || !el.isConnected) return Infinity;
    const r = el.getBoundingClientRect();
    const vh = innerHeight;
    if (r.bottom >= 0 && r.top <= vh) return 0;
    return r.top > vh ? r.top - vh : -r.bottom + 200; // content above the viewport is less urgent
  }

  function pump() {
    if (!S.active || S.paused) return;
    while (S.inflight.size < MAX_OUTSTANDING && S.waiting.length) {
      // Visible units first; among those the longest (the body text) first, so on a slow engine
      // the article is not stuck behind dozens of short navigation/sidebar items that precede it
      // in DOM order. Short items still flow through the remaining slots.
      let best = 0;
      let bestD = Infinity;
      let bestLen = -1;
      for (let i = 0; i < S.waiting.length; i++) {
        const d = distance(S.waiting[i]);
        const len = d === 0 ? S.waiting[i].src.length : 0;
        if (d < bestD || (d === 0 && len > bestLen)) {
          bestD = d;
          best = i;
          bestLen = len;
        }
      }
      const unit = S.waiting.splice(best, 1)[0];
      if (!unit.parent.isConnected || !attached(unit)) {
        unit.state = 'stale';
        continue;
      }
      const id = ++S.seq;
      unit.state = 'inflight';
      S.inflight.set(id, unit);
      try {
        getPort().postMessage({ type: 'tr', id, text: unit.src, target: S.target, context: S.context });
      } catch {
        S.port = null;
        S.inflight.delete(id);
        unit.state = 'waiting';
        S.waiting.push(unit);
        setTimeout(pump, 300);
        return;
      }
      glow.add(unit);
    }
    ui.update();
  }

  function onResult(msg) {
    if (msg.type === 'engine') {
      S.engineLoading = msg.state === 'loading';
      ui.update();
      return;
    }
    const unit = S.inflight.get(msg.id);
    if (!unit) return;
    S.inflight.delete(msg.id);
    if (msg.type === 'res') {
      unit.translation = msg.text;
      unit.state = 'done';
      S.done++;
      if (S.active) withObserverPaused(() => apply(unit));
    } else {
      unit.state = 'error';
      unit.error = msg;
      S.failed++;
      if (['NO_MODEL', 'LOAD_FAILED', 'BAD_MODEL'].includes(msg.code)) {
        S.paused = msg;
      }
    }
    glow.remove(unit);
    if (glow.size) glow.placeAll();
    pump();
    ui.update();
  }

  // ---------------------------------------------------------------- visibility & mutations
  function track(units) {
    for (const u of units) {
      S.units.push(u);
      let el = u.parent.nodeType === Node.ELEMENT_NODE ? u.parent : u.parent.host;
      if (!el) continue;
      let list = S.anchorUnits.get(el);
      if (!list) {
        list = [];
        S.anchorUnits.set(el, list);
        S.io.observe(el);
      }
      list.push(u);
    }
  }

  function onIntersect(entries) {
    let any = false;
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      S.io.unobserve(e.target);
      const list = S.anchorUnits.get(e.target) || [];
      S.anchorUnits.delete(e.target);
      for (const u of list) enqueue(u);
      any = true;
    }
    if (any) pump();
  }

  let observerPaused = 0;
  function withObserverPaused(fn) {
    observerPaused++;
    try {
      fn();
    } finally {
      // records produced by our own changes are dropped
      S.mo?.takeRecords();
      observerPaused--;
    }
  }

  function onMutations(records) {
    if (observerPaused) return;
    for (const r of records) {
      for (const n of r.addedNodes) {
        if (ownNodes.has(n)) continue;
        if (n.nodeType === Node.ELEMENT_NODE) S.dirty.add(n);
        else if (n.nodeType === Node.TEXT_NODE && !processedText.has(n) && n.parentElement) S.dirty.add(n.parentElement);
      }
    }
    if (S.dirty.size && !S.scanTimer) {
      S.scanTimer = setTimeout(() => {
        S.scanTimer = 0;
        const roots = [...S.dirty].filter((n) => n.isConnected);
        S.dirty.clear();
        for (const r of roots) {
          if (r.closest?.('plamo-ui,plamo-t')) continue;
          // a new text node inside an existing paragraph: rescan the paragraph's block
          let root = r;
          while (root.parentElement && isInlineNode(root)) root = root.parentElement;
          track(scan(root));
        }
        ui.update();
      }, 400);
    }
  }

  // ---------------------------------------------------------------- lifecycle
  // knownLang: the page language, when content/detect.js already found it
  async function start(knownLang) {
    if (S.active) return;
    S.offer = null;
    const cfg = await chrome.runtime.sendMessage({ type: 'pageSettings' });
    S.mode = cfg.pageMode || 'replace';
    S.altTarget = cfg.altTargetLang || 'en';
    S.target = cfg.targetLang || 'ja';
    // page already in the target language? translate into the alternative language instead
    let pageLang = knownLang || null;
    if (!pageLang) {
      const sample = (document.title + '\n' + (document.body?.innerText || '').slice(0, 2000)).trim();
      try {
        pageLang = (await chrome.runtime.sendMessage({ type: 'detectLang', text: sample }))?.lang;
      } catch {}
    }
    const base = S.target === 'ja(easy)' ? 'ja' : S.target;
    if (pageLang && pageLang === base) S.target = S.altTarget;
    S.context = cfg.useTitleContext ? document.title.trim().slice(0, 160) : '';
    glow.setEnabled(cfg.pageGlow !== false);
    S.active = true;
    S.paused = null;
    S.done = S.failed = 0;
    blockCache = new WeakMap();
    displayCache = new WeakMap();
    S.io = new IntersectionObserver(onIntersect, { rootMargin: '600px 0px 1000px 0px' });
    S.mo = new MutationObserver(onMutations);
    S.mo.observe(document.body, { childList: true, subtree: true });
    ui.show();
    track(scan(document.body));
    ui.update();
    notify();
  }

  function stop() {
    if (!S.active) return;
    S.active = false;
    S.io?.disconnect();
    S.mo?.disconnect();
    clearTimeout(S.scanTimer);
    S.scanTimer = 0;
    try {
      S.port?.postMessage({ type: 'cancel' });
      S.port?.disconnect();
    } catch {}
    S.port = null;
    for (let i = S.units.length - 1; i >= 0; i--) restore(S.units[i]);
    // forget everything so a new start rescans the restored page
    for (const u of S.units) for (const t of textNodesIn(u.origTop || u.nodes)) processedText.delete(t);
    S.units = [];
    S.waiting = [];
    S.inflight.clear();
    S.anchorUnits.clear();
    glow.detach();
    ui.hide();
    notify();
  }

  function setMode(mode) {
    if (mode !== 'replace' && mode !== 'bilingual') return;
    S.mode = mode;
    if (!S.active) return;
    withObserverPaused(() => {
      for (let i = S.units.length - 1; i >= 0; i--) if (S.units[i].applied) restore(S.units[i]);
      for (const u of S.units) if (u.state === 'done') apply(u);
    });
    if (S.mode === 'replace') {
      glow.sync();
      glow.placeAll();
    } else glow.clear();
    ui.update();
  }

  function resume() {
    S.paused = null;
    for (const u of S.units) {
      if (u.state === 'error') {
        u.state = 'waiting';
        S.failed = Math.max(0, S.failed - 1);
        S.waiting.push(u);
      }
    }
    pump();
    ui.update();
  }

  function notify() {
    chrome.runtime.sendMessage({ type: 'pageStateChanged', active: S.active }).catch(() => {});
  }

  function stats() {
    let total = 0;
    for (const u of S.units) if (u.state !== 'skip' && u.state !== 'stale') total++;
    const visibleTotal = S.done + S.failed + S.inflight.size + S.waiting.length;
    let fallback = 0;
    let repaired = 0;
    for (const u of S.units) {
      if (u.fallback && u.applied) fallback++;
      if (u.repaired && u.applied) repaired++;
    }
    return { total, visibleTotal, done: S.done, failed: S.failed, fallback, repaired, busy: S.inflight.size + S.waiting.length };
  }

  // ---------------------------------------------------------------- glass over the units in flight (置換 only)
  // Drawn in a shadow root of its own, in page coordinates, so it scrolls with the text at no cost.
  // The glass is only a blur with faded edges, shaped to the lines of text a reader sees: a plain background
  // stays exactly as it is, the letters look frosted, and an image beside the first lines stays sharp.
  // The light is a brightness/contrast pair whose fixed point is the colour behind the text, so it brightens
  // the letters and leaves the background alone. Text on an image or a gradient, in a box that scrolls on
  // its own or in a fixed/sticky part gets nothing.
  const glow = (() => {
    const PERIOD = 2600; // one pass of the light and a short rest
    const LEAN = Math.tan((22 * Math.PI) / 180);
    const BAND = 180; // width of a light band
    const SPACING = 1100; // the light is a row of parallel bands this far apart, fixed to the page
    const reduce = matchMedia('(prefers-reduced-motion: reduce)');
    const range = document.createRange();
    const live = new Map(); // unit -> { fx, pane, el, clips, lights, box }
    let enabled = true;
    let host = null;
    let root = null;
    let origin = null; // 0x0 probe at the origin of the page coordinates
    let tick = 0;
    let raf = 0;
    let queued = 0;
    let settle = 0;
    let lastPlace = 0;
    const css = `
      :host { all: initial; }
      .o { position: absolute; left: 0; top: 0; width: 0; height: 0; }
      .fx { position: absolute; z-index: 2147483646; pointer-events: none; }
      .pane { position: absolute; inset: 0; backdrop-filter: blur(2.5px);
        mask-image: linear-gradient(90deg, transparent, #000 10px, #000 calc(100% - 10px), transparent),
          linear-gradient(transparent, #000 6px, #000 calc(100% - 6px), transparent);
        mask-composite: intersect; }
      /* one per run of lines; a plain clip: a mask or opacity here would cut the light off from the page */
      .lit { position: absolute; overflow: hidden; }
      .band { position: absolute; top: 0; left: 0; height: 100%; width: ${BAND}px; transform-origin: 0 0;
        backdrop-filter: var(--light); mask-image: linear-gradient(90deg, transparent, #000 50%, transparent); }
      /* fade the filtered elements themselves: a fading ancestor would become their backdrop root */
      .pane, .band { opacity: 0; transition: opacity 180ms cubic-bezier(.22, 1, .36, 1); }
      .fx.on .pane, .fx.on .band { opacity: 1; }
      .fx.out .pane, .fx.out .band { opacity: 0; transition-duration: 380ms; }`;

    const rgba = (s) => {
      if (!/^rgba?\(/.test(s || '')) return null; // oklch(), color(): unknown, no glass
      const m = s.match(/[\d.]+/g);
      return m && m.length >= 3 ? [+m[0], +m[1], +m[2], m.length > 3 ? +m[3] : 1] : null;
    };
    const up = (n) => n.parentElement || (n.getRootNode?.() instanceof ShadowRoot ? n.getRootNode().host : null);

    // the colour the text sits on, walking up; null where the glass could show a seam or lose the text
    function lookOf(el) {
      const layers = [];
      const clips = [];
      let base = null;
      for (let n = el; n; n = up(n)) {
        const cs = getComputedStyle(n);
        if (cs.position === 'fixed' || cs.position === 'sticky') return null;
        if (!base) {
          if (cs.backgroundImage !== 'none') return null;
          const c = rgba(cs.backgroundColor);
          if (!c) return null;
          if (c[3] >= 0.99) base = c;
          else if (c[3] > 0) layers.push(c);
        }
        if (n !== document.documentElement && n !== document.body && (cs.overflowX !== 'visible' || cs.overflowY !== 'visible')) {
          // a box that scrolls by itself would move the text away from the glass
          if (/auto|scroll/.test(cs.overflowX + cs.overflowY) && (n.scrollHeight > n.clientHeight + 1 || n.scrollWidth > n.clientWidth + 1)) return null;
          clips.push(n);
        }
      }
      if (!base) base = /dark/.test(getComputedStyle(document.documentElement).colorScheme) && matchMedia('(prefers-color-scheme: dark)').matches ? [18, 18, 18, 1] : [255, 255, 255, 1];
      for (let i = layers.length - 1; i >= 0; i--) {
        const [r, g, b, a] = layers[i];
        base = [base[0] * (1 - a) + r * a, base[1] * (1 - a) + g * a, base[2] * (1 - a) + b * a, 1];
      }
      const ink = rgba(getComputedStyle(el).color);
      return ink ? { light: lightFor(base, ink), clips } : null;
    }

    function lightFor(bg, ink) {
      const L = (bg[0] + bg[1] + bg[2]) / 765;
      if ((ink[0] + ink[1] + ink[2]) / 765 < L) {
        // dark letters: lower the contrast toward the background, then brightness brings the background back
        const c = 0.45;
        return `contrast(${c}) brightness(${Math.min(3, L / ((L - 0.5) * c + 0.5)).toFixed(3)})`;
      }
      // light letters: a gain of 1.4 around the background colour (a larger gain spreads a tinted background)
      const c = 1 + 2 * L * 0.4;
      return `brightness(${(1.4 / c).toFixed(3)}) contrast(${c.toFixed(3)})`;
    }

    function ensureHost() {
      if (host?.isConnected) return;
      host = document.createElement('plamo-fx');
      ownNodes.add(host);
      root = host.attachShadow({ mode: 'open' });
      root.innerHTML = `<style>${css}</style><div class="o"></div>`;
      origin = root.querySelector('.o');
      document.documentElement.appendChild(host);
    }

    // what covers the text at a point (a fixed header, a cookie bar), if anything
    function cover(el, x, y) {
      if (y < 1 || y > innerHeight - 1 || x < 1 || x > innerWidth - 1) return null;
      const hit = document.elementFromPoint(x, y);
      if (!hit || ownNodes.has(hit) || el.contains(hit)) return null;
      for (let n = el; n; n = up(n)) if (n === hit) return null;
      return hit;
    }

    // The lines a reader sees, in runs with the same ends. Labels moved off the page or shrunk to 1 px for
    // screen readers do not count (Wikipedia's "Jump up to:" sits 99999 px above the page). A float beside
    // some lines starts a new run, so the glass keeps off it; a short last line stays in its run.
    function runsOf(o) {
      const de = document.documentElement;
      const endX = o.left + de.scrollWidth;
      const endY = o.top + de.scrollHeight;
      const rects = [...range.getClientRects()]
        .filter((r) => r.width >= 2 && r.height >= 2 && r.right > o.left && r.bottom > o.top && r.left < endX && r.top < endY)
        .sort((p, q) => p.top - q.top);
      const lines = [];
      for (const r of rects) {
        const l = lines[lines.length - 1];
        if (l && r.top < l.bottom - Math.min(r.height, l.bottom - l.top) * 0.3) {
          l.left = Math.min(l.left, r.left);
          l.right = Math.max(l.right, r.right);
          l.bottom = Math.max(l.bottom, r.bottom);
        } else lines.push({ left: r.left, right: r.right, top: r.top, bottom: r.bottom });
      }
      const runs = [];
      lines.forEach((l, i) => {
        const run = runs[runs.length - 1];
        const lastShorter = run && i === lines.length - 1 && l.right <= run.end;
        if (run && Math.abs(l.left - run.start) <= 24 && (Math.abs(l.right - run.end) <= 120 || lastShorter)) {
          run.left = Math.min(run.left, l.left);
          run.right = Math.max(run.right, l.right);
          run.bottom = Math.max(run.bottom, l.bottom);
          run.start = l.left;
          run.end = l.right;
        } else runs.push({ left: l.left, right: l.right, top: l.top, bottom: l.bottom, start: l.left, end: l.right });
      });
      return runs;
    }

    // where the glass goes, in page coordinates (reads only); null: nowhere
    function measure(unit, g, o) {
      try {
        range.setStartBefore(unit.nodes[0]);
        range.setEndAfter(unit.nodes[unit.nodes.length - 1]);
      } catch {
        return null;
      }
      const runs = runsOf(o);
      if (!runs.length) return null;
      let left = Math.min(...runs.map((r) => r.left));
      let right = Math.max(...runs.map((r) => r.right));
      let top = runs[0].top;
      let bottom = Math.max(...runs.map((r) => r.bottom));
      // the glass reaches past the text by its faded edge, except where something cuts the text off
      const m = { l: 10, r: 10, t: 6, b: 6 };
      for (const c of g.clips) {
        // stay inside every box that clips the text (an ellipsis, a carousel)
        const r = c.getBoundingClientRect();
        if (r.left > left) [left, m.l] = [r.left, 0];
        if (r.right < right) [right, m.r] = [r.right, 0];
        if (r.top > top) [top, m.t] = [r.top, 0];
        if (r.bottom < bottom) [bottom, m.b] = [r.bottom, 0];
      }
      if (right - left < 2 || bottom - top < 2) return null;
      const mid = (r) => Math.min(Math.max((Math.max(r.left, left) + Math.min(r.right, right)) / 2, left + 1), right - 1);
      const big = runs.reduce((p, q) => ((q.right - q.left) * (q.bottom - q.top) > (p.right - p.left) * (p.bottom - p.top) ? q : p));
      if (cover(g.el, mid(big), (Math.max(big.top, top) + Math.min(big.bottom, bottom)) / 2)) return null;
      const first = runs[0];
      const last = runs[runs.length - 1];
      const t = cover(g.el, mid(first), top + 3)?.getBoundingClientRect().bottom;
      if (t > top) [top, m.t] = [t, 0];
      const d = cover(g.el, mid(last), bottom - 3)?.getBoundingClientRect().top;
      if (d < bottom) [bottom, m.b] = [d, 0];
      if (bottom - top < 2) return null;
      // never past the document's own scroll size: the glass must not add a scroll bar
      const de = document.documentElement;
      const bx = Math.max(0, left - o.left - m.l);
      const by = Math.max(0, top - o.top - m.t);
      const w = Math.min(right - o.left + m.r, de.scrollWidth) - bx;
      const h = Math.min(bottom - o.top + m.b, de.scrollHeight) - by;
      if (w < 2 || h < 2) return null;
      const cut = runs
        .map((r) => ({ left: Math.max(r.left, left), right: Math.min(r.right, right), top: Math.max(r.top, top), bottom: Math.min(r.bottom, bottom) }))
        .filter((r) => r.right - r.left >= 2 && r.bottom - r.top >= 2);
      if (!cut.length) return null;
      // the runs in the glass's own coordinates, stacked without gaps
      const X = (v) => v - o.left - bx;
      const Y = (v) => v - o.top - by;
      const edges = [Y(cut[0].top)];
      for (let i = 1; i < cut.length; i++) edges.push(Y((cut[i - 1].bottom + cut[i].top) / 2));
      edges.push(Y(cut[cut.length - 1].bottom));
      const lights = cut.map((r, i) => ({ x: X(r.left), y: edges[i], w: r.right - r.left, h: edges[i + 1] - edges[i] }));
      // the blur's outline: 10 px beside each run (the box's own margin where the run reaches its edge)
      const ys = [0, ...edges.slice(1, -1), h];
      const fit = (v, max) => Math.min(max, Math.max(0, v));
      const pts = [];
      cut.forEach((r, i) => {
        const x = fit(X(r.right) + (r.right >= right - 0.5 ? m.r : 10), w);
        pts.push([x, ys[i]], [x, ys[i + 1]]);
      });
      for (let i = cut.length - 1; i >= 0; i--) {
        const x = fit(X(cut[i].left) - (cut[i].left <= left + 0.5 ? m.l : 10), w);
        pts.push([x, ys[i + 1]], [x, ys[i]]);
      }
      return { x: bx, y: by, w, h, pts, lights };
    }

    function placeAll() {
      lastPlace = performance.now();
      if (!live.size || !origin) return;
      const o = origin.getBoundingClientRect();
      const boxes = [];
      for (const [u, g] of live) boxes.push([g, measure(u, g, o)]);
      for (const [g, b] of boxes) {
        g.box = b;
        if (!b) {
          g.fx.style.display = 'none';
          continue;
        }
        Object.assign(g.fx.style, { display: '', left: `${b.x}px`, top: `${b.y}px`, width: `${b.w}px`, height: `${b.h}px` });
        g.pane.style.clipPath = `polygon(${b.pts.map(([x, y]) => `${x.toFixed(1)}px ${y.toFixed(1)}px`).join(', ')})`;
        if (!reduce.matches) light(g, b);
      }
    }

    // The light is a row of parallel bands SPACING apart, fixed to the page and moving one SPACING per
    // pass: every paragraph shows its slice of the same light, and nothing jumps when the page scrolls or
    // paragraphs come and go. A run's bands are set again only when the run itself moves.
    function light(g, b) {
      while (g.lights.length > b.lights.length) g.lights.pop().el.remove();
      while (g.lights.length < b.lights.length) {
        const el = g.fx.appendChild(document.createElement('div'));
        el.className = 'lit';
        g.lights.push({ el, key: '', bands: [] });
      }
      b.lights.forEach((r, i) => {
        const l = g.lights[i];
        Object.assign(l.el.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
        const px = b.x + r.x;
        const py = b.y + r.y;
        const key = [px, py, r.w, r.h].map(Math.round).join();
        if (key === l.key) return;
        l.key = key;
        // band k's left edge at the run's top starts at off + k * SPACING; the bands that cross the run
        const off = (((-LEAN * py - px) % SPACING) + SPACING) % SPACING;
        const from = Math.floor((-BAND - off) / SPACING);
        const n = Math.ceil((r.w + LEAN * r.h - off) / SPACING) - from;
        while (l.bands.length > n) l.bands.pop().remove();
        while (l.bands.length < n) {
          const band = l.el.appendChild(document.createElement('div'));
          band.className = 'band';
          l.bands.push(band);
        }
        l.bands.forEach((band, j) => {
          const x = off + (from + j) * SPACING;
          band.getAnimations().forEach((a) => a.cancel());
          const a = band.animate([
            { transform: `translateX(${x}px) skewX(-22deg)`, easing: 'cubic-bezier(.45, 0, .25, 1)' },
            { transform: `translateX(${x + SPACING}px) skewX(-22deg)`, offset: 0.7 },
            { transform: `translateX(${x + SPACING}px) skewX(-22deg)` },
          ], { duration: PERIOD, iterations: Infinity });
          a.startTime = 0; // one phase for the whole page
        });
      });
    }

    // one placement per frame however many units change
    function queue() {
      if (!queued) {
        queued = requestAnimationFrame(() => {
          queued = 0;
          placeAll();
        });
      }
    }

    function onScroll() {
      // the glass scrolls with the page by itself; fixed parts and boxes that scroll need a new look
      if (!raf && performance.now() - lastPlace > 100) {
        raf = requestAnimationFrame(() => {
          raf = 0;
          placeAll();
        });
      }
      clearTimeout(settle);
      settle = setTimeout(placeAll, 120);
    }

    function arm() {
      if (tick) return;
      addEventListener('scroll', onScroll, { capture: true, passive: true });
      addEventListener('resize', queue, { passive: true });
      tick = setInterval(placeAll, 500); // the page may move the text by itself (images, ads)
    }

    function disarm() {
      removeEventListener('scroll', onScroll, { capture: true });
      removeEventListener('resize', queue);
      clearInterval(tick);
      clearTimeout(settle);
      cancelAnimationFrame(raf);
      cancelAnimationFrame(queued);
      tick = raf = queued = 0;
    }

    function add(unit) {
      if (!enabled || !S.active || S.mode !== 'replace' || live.has(unit)) return;
      const el = unit.parent.nodeType === Node.ELEMENT_NODE ? unit.parent : unit.parent.host;
      if (!el?.isConnected) return;
      let look = null;
      try {
        look = lookOf(el);
      } catch {}
      if (!look) return;
      ensureHost();
      const fx = root.appendChild(document.createElement('div'));
      fx.className = 'fx';
      fx.style.display = 'none';
      fx.style.setProperty('--light', look.light);
      const pane = fx.appendChild(document.createElement('div'));
      pane.className = 'pane';
      const g = { fx, pane, el, clips: look.clips, lights: [], box: null };
      live.set(unit, g);
      queue();
      // placed in the next frame, faded in the one after; a result from the cache may come first
      requestAnimationFrame(() => requestAnimationFrame(() => live.get(unit) === g && fx.classList.add('on')));
      arm();
    }

    function remove(unit, fade = true) {
      const g = live.get(unit);
      if (!g) return;
      live.delete(unit);
      const kill = () => {
        for (const l of g.lights) for (const band of l.bands) band.getAnimations().forEach((a) => a.cancel());
        g.fx.remove();
      };
      if (fade && g.fx.classList.contains('on') && g.box) {
        g.fx.classList.replace('on', 'out');
        setTimeout(kill, 420);
      } else kill();
      if (!live.size) disarm();
    }

    function clear() {
      for (const u of [...live.keys()]) remove(u, false);
    }

    function sync() {
      for (const u of S.inflight.values()) add(u);
    }

    function setEnabled(v) {
      enabled = v;
      if (v) sync();
      else clear();
    }

    function detach() {
      clear();
      host?.remove();
      host = root = origin = null;
    }

    reduce.addEventListener('change', () => {
      const units = [...live.keys()];
      clear();
      units.forEach(add);
    });

    return { add, remove, clear, sync, setEnabled, detach, placeAll, get size() { return live.size; } };
  })();

  // the setting can change while a page is being translated
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.pageGlow) glow.setEnabled(changes.pageGlow.newValue !== false);
  });

  // ---------------------------------------------------------------- floating status pill
  const ui = (() => {
    let host = null;
    let els = null;
    let hideTimer = 0;
    let offerTimer = 0;
    const offering = () => !!S.offer && !S.active;
    // graphite neutrals and the 藍 accent of the extension pages (ui/base.css), inside a shadow root
    const css = `
      :host { all: initial; }
      [hidden] { display: none !important; }
      .pill { position: fixed; right: 16px; bottom: 16px; z-index: 2147483647; display: flex; align-items: center; gap: 8px;
        padding: 4px 4px 4px 8px; border-radius: 12px; font: 12px/1.4 system-ui, "Segoe UI", "Yu Gothic UI", "Meiryo", sans-serif;
        color: var(--fg); background: var(--bg); border: 1px solid var(--border);
        box-shadow: 0 8px 24px rgba(0,0,0,.12), 0 1px 3px rgba(0,0,0,.06);
        transition: opacity 200ms cubic-bezier(.22,1,.36,1), transform 200ms cubic-bezier(.22,1,.36,1); user-select: none; }
      .pill.min { padding: 0; gap: 0; border-radius: 10px; }
      .pill.min > :not(.badge) { display: none; }
      .badge { width: 24px; height: 24px; border-radius: 6px; display: grid; place-items: center; background: var(--accent);
        color: #fff; font-size: 12px; font-weight: 600; flex: none; cursor: default; }
      .pill.min .badge { width: 32px; height: 32px; border-radius: 9px; font-size: 15px; cursor: pointer; }
      .pill.min.busy .badge { animation: busy 1.6s ease-in-out infinite; }
      @keyframes busy { 50% { opacity: .55; } }
      .spin { width: 12px; height: 12px; border-radius: 50%; border: 2px solid var(--track); border-top-color: var(--accent-fg);
        animation: spin .8s linear infinite; flex: none; }
      @keyframes spin { to { transform: rotate(360deg); } }
      .msg { white-space: nowrap; max-width: 320px; overflow: hidden; text-overflow: ellipsis; font-variant-numeric: tabular-nums; }
      .msg.err { color: var(--danger); white-space: normal; }
      .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
      .seg { display: inline-flex; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
      .seg button, .btn { all: unset; cursor: pointer; padding: 4px 12px; font-size: 12px; color: var(--muted);
        transition: background-color 150ms cubic-bezier(.22,1,.36,1), color 150ms cubic-bezier(.22,1,.36,1); }
      .seg button + button { border-left: 1px solid var(--border); }
      .seg button[aria-pressed="true"] { background: var(--accent-soft); color: var(--accent-fg); font-weight: 500; }
      .btn { border-radius: 8px; color: var(--fg); background: var(--chip); }
      .btn:hover { background: var(--chip-hover); }
      .btn.go { background: var(--accent); color: #fff; font-weight: 500; }
      .btn.go:hover { background: var(--accent-hover); }
      .btn.never { background: transparent; color: var(--muted); padding: 4px 8px; }
      .btn.never:hover { background: var(--chip); color: var(--fg); }
      .seg button:hover { color: var(--fg); }
      .x { all: unset; cursor: pointer; width: 24px; height: 24px; border-radius: 6px; display: grid; place-items: center; color: var(--muted);
        transition: background-color 150ms cubic-bezier(.22,1,.36,1), color 150ms cubic-bezier(.22,1,.36,1); }
      .x:hover { background: var(--chip); color: var(--fg); }
      button:focus-visible, .badge:focus-visible { outline: 2px solid var(--accent-fg); outline-offset: 2px; }
      :host { --bg: #ffffff; --fg: #171717; --muted: #525252; --border: rgba(23,23,23,.1); --chip: rgba(23,23,23,.06); --chip-hover: rgba(23,23,23,.1);
        --accent: #165e83; --accent-hover: #124d6b; --accent-soft: rgba(22,94,131,.08); --accent-fg: #165e83; --track: rgba(22,94,131,.2); --danger: #dc2626; }
      @media (prefers-color-scheme: dark) {
        :host { --bg: #19191b; --fg: #ededed; --muted: #a1a1a6; --border: rgba(237,237,237,.1); --chip: rgba(237,237,237,.08); --chip-hover: rgba(237,237,237,.13);
          --accent: #1d6f99; --accent-hover: #2580ae; --accent-soft: rgba(128,188,218,.12); --accent-fg: #80bcda; --track: rgba(128,188,218,.25); --danger: #e5484d; }
      }`;
    function show() {
      if (host) return;
      host = document.createElement('plamo-ui');
      ownNodes.add(host);
      const root = host.attachShadow({ mode: 'open' });
      root.innerHTML = `<style>${css}</style>
        <div class="pill" part="pill">
          <span class="badge" title="PLaMo 3 Translate">訳</span>
          <span class="spin" hidden></span>
          <span class="msg"></span>
          <span class="seg" role="group" aria-label="表示方法">
            <button data-mode="replace">置換</button><button data-mode="bilingual">併記</button>
          </span>
          <button class="btn go" hidden></button>
          <button class="btn never" hidden>このサイトでは尋ねない</button>
          <button class="btn retry" hidden>再試行</button>
          <button class="btn off">原文に戻す</button>
          <button class="x" title="最小化" aria-label="最小化">
            <svg width="12" height="12" viewBox="0 0 12 12"><path d="M2.5 6h7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
          </button>
        </div>`;
      els = {
        pill: root.querySelector('.pill'),
        badge: root.querySelector('.badge'),
        spin: root.querySelector('.spin'),
        msg: root.querySelector('.msg'),
        retry: root.querySelector('.retry'),
        off: root.querySelector('.off'),
        x: root.querySelector('.x'),
        xPath: root.querySelector('.x path'),
        go: root.querySelector('.go'),
        never: root.querySelector('.never'),
        segWrap: root.querySelector('.seg'),
        seg: [...root.querySelectorAll('.seg button')],
      };
      els.off.onclick = () => stop();
      els.retry.onclick = () => (S.paused?.code === 'NO_MODEL' ? chrome.runtime.sendMessage({ type: 'openOptions' }) : resume());
      els.x.onclick = () => (offering() ? dismiss() : els.pill.classList.add('min'));
      els.go.onclick = () => {
        if (els.go.disabled) return;
        els.go.disabled = true;
        clearTimeout(offerTimer);
        start(S.offer?.lang);
      };
      els.never.onclick = () => {
        chrome.runtime.sendMessage({ type: 'autoPageSkip', host: location.hostname, skip: true }).catch(() => {});
        S.offer = { ...S.offer, skipped: true };
        update();
        clearTimeout(offerTimer);
        offerTimer = setTimeout(dismiss, 2000);
      };
      els.badge.onclick = () => els.pill.classList.remove('min');
      for (const b of els.seg) {
        b.onclick = () => {
          setMode(b.dataset.mode);
          chrome.storage.local.set({ pageMode: b.dataset.mode }).catch(() => {});
        };
      }
      document.documentElement.appendChild(host);
    }
    // autoPage 'ask': offer to translate this page; folds into the badge after a while (the badge opens it again)
    function offer(o) {
      if (S.active) return;
      S.offer = o;
      show();
      els.pill.classList.remove('min');
      els.msg.setAttribute('role', 'status'); // read out once: the offer appears without taking focus
      setTimeout(update, 50);
      clearTimeout(offerTimer);
      offerTimer = setTimeout(() => {
        if (els && offering() && !els.pill.matches(':hover, :focus-within')) els.pill.classList.add('min');
      }, 10000);
    }
    function dismiss() {
      clearTimeout(offerTimer);
      S.offer = null;
      if (!S.active) hide();
    }
    function hide() {
      clearTimeout(hideTimer);
      clearTimeout(offerTimer);
      host?.remove();
      host = null;
      els = null;
    }
    function update() {
      if (!els) return;
      const asking = offering();
      els.go.hidden = els.never.hidden = !asking || !!S.offer.skipped;
      els.segWrap.hidden = els.off.hidden = asking;
      const xName = asking ? '閉じる' : '最小化';
      els.x.title = xName;
      els.x.setAttribute('aria-label', xName);
      els.xPath.setAttribute('d', asking ? 'M3 3l6 6M9 3l-6 6' : 'M2.5 6h7');
      if (asking) {
        els.spin.hidden = els.retry.hidden = true;
        els.msg.classList.remove('err');
        // the language alone on screen; screen readers get 「英語のページ」
        if (S.offer.skipped) els.msg.textContent = 'このサイトでは今後尋ねません';
        else els.msg.replaceChildren(S.offer.from, Object.assign(document.createElement('span'), { className: 'sr', textContent: 'のページ' }));
        els.go.textContent = `${S.offer.to}に翻訳`;
        els.go.disabled = false;
        return;
      }
      els.msg.removeAttribute('role');
      const st = stats();
      for (const b of els.seg) b.setAttribute('aria-pressed', String(b.dataset.mode === S.mode));
      els.retry.hidden = !S.paused && !st.failed;
      els.retry.textContent = S.paused?.code === 'NO_MODEL' ? '設定を開く' : '再試行';
      els.msg.classList.toggle('err', !!S.paused);
      if (S.paused) {
        els.spin.hidden = true;
        els.msg.textContent = S.paused.message || '翻訳できません';
        els.pill.classList.remove('min');
        return;
      }
      els.pill.classList.toggle('busy', !!st.busy);
      if (st.busy) {
        els.spin.hidden = false;
        els.msg.textContent = S.engineLoading ? '翻訳モデルを読み込み中…' : `翻訳中 ${st.done}/${st.visibleTotal}`;
        if (S.engineLoading) els.pill.classList.remove('min');
        clearTimeout(hideTimer);
        hideTimer = 0;
      } else {
        els.spin.hidden = true;
        els.msg.textContent = st.failed ? `翻訳済み ${st.done}・失敗 ${st.failed}` : `翻訳済み ${st.done}`;
        if (!hideTimer && !st.failed) hideTimer = setTimeout(() => els?.pill.classList.add('min'), 2500);
      }
    }
    return { show, hide, update, offer };
  })();

  // ---------------------------------------------------------------- messages
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || typeof msg.type !== 'string' || !msg.type.startsWith('plamo:')) return;
    if (msg.type === 'plamo:togglePage') {
      const want = msg.force === 'on' ? true : msg.force === 'off' ? false : !S.active;
      (want ? start(msg.pageLang) : Promise.resolve(stop())).then(
        () => sendResponse({ active: S.active, mode: S.mode, target: S.target }),
        (e) => sendResponse({ active: S.active, error: { message: String(e?.message || e) } }),
      );
      return true;
    }
    if (msg.type === 'plamo:offer') {
      ui.offer({ lang: msg.lang, from: msg.from, to: msg.to });
      sendResponse({ ok: true, active: S.active });
      return;
    }
    if (msg.type === 'plamo:pageState') {
      sendResponse({ active: S.active, mode: S.mode, target: S.target, ...stats() });
      return;
    }
    if (msg.type === 'plamo:setMode') {
      setMode(msg.mode);
      sendResponse({ ok: true, mode: S.mode });
    }
  });

  api.start = start;
  api.stop = stop;
  api.setMode = setMode;
  api.state = S;
  api.stats = stats;
  api.glow = glow;
})();
