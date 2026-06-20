/* global Papa, App */
const Bibs = (() => {
  const STORAGE_KEY = 'wa_vl_bib_config_v1';

  function h(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // Convert ALL-CAPS names (as exported by Vertical Life) to Title Case.
  // Leaves already-mixed-case names untouched.
  function normalizeName(str) {
    if (!str || /[a-z]/.test(str)) return str;
    return str.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
  }

  // ── State ─────────────────────────────────────────────────────────────────
  let athletes        = [];
  let fileName        = '';
  let view            = 'upload'; // 'upload' | 'config' | 'design' | 'select' | 'preview'
  let selectedBibs    = new Set();
  let selectFilterCat  = '';
  let selectFilterDisc = '';
  let selectFilterName = '';

  const DEFAULT_FONT_SIZES = { eventName: 24, bibNumber: 184, athleteName: 32, category: 19 };
  const DEFAULT_POSITIONS  = { eventName: 7, bibNumber: 25, athleteName: 94, category: 109 };

  function loadConfig() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (saved && saved.images && saved.images.length === 3) {
        if (!saved.fontSizes) saved.fontSizes = { ...DEFAULT_FONT_SIZES };
        if (!saved.positions) saved.positions = { ...DEFAULT_POSITIONS };
        if (saved.includeDiscipline === undefined) saved.includeDiscipline = false;
        return saved;
      }
    } catch {}
    return {
      eventName: '',
      images: [
        { data: null, position: 'top-left',      size: 18 },
        { data: null, position: 'top-right',     size: 18 },
        { data: null, position: 'bottom-center', size: 35 },
      ],
      fontSizes:         { ...DEFAULT_FONT_SIZES },
      positions:         { ...DEFAULT_POSITIONS },
      includeDiscipline: false,
    };
  }

  const config = loadConfig();

  function saveConfig() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(config)); } catch {}
  }

  // ── CSV Parsing ───────────────────────────────────────────────────────────
  // Vertical Life export is semicolon-delimited.
  // Category is derived from which event columns contain "registered".
  // Column name format: "LEAD U17 Female", "BOULDER U15 Male", etc.
  function parseBibCsv(text) {
    const result = Papa.parse(text.trim(), {
      header:         true,
      delimiter:      ';',
      skipEmptyLines: true,
    });

    const CAT_RE = /^(LEAD|BOULDER|SPEED)\s+(U\d+)\s+(Female|Male)$/i;

    return result.data.map(row => {
      const catCols = Object.keys(row).filter(k => CAT_RE.test(k.trim()));
      const matched = catCols.filter(k =>
        String(row[k] ?? '').toLowerCase().trim() === 'registered'
      );

      let ageGender = '';
      const disciplines = [];
      for (const col of matched) {
        const m = col.trim().match(CAT_RE);
        if (!m) continue;
        const disc = m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase();
        if (!disciplines.includes(disc)) disciplines.push(disc);
        if (!ageGender) ageGender = `${m[2]} ${m[3]}`;
      }

      const categoryLine = ageGender
        ? `${ageGender}${disciplines.length ? ' · ' + disciplines.join(' & ') : ''}`
        : '';

      return {
        bib:          String(row.bib ?? '').trim(),
        first:        normalizeName(String(row.firstname ?? '').trim()),
        last:         normalizeName(String(row.lastname  ?? '').trim()),
        ageGender,
        disciplines,
        categoryLine,
      };
    }).filter(a => a.bib && a.first);
  }

  // ── Image position helpers ────────────────────────────────────────────────
  const POSITIONS = [
    'top-left', 'top-center', 'top-right',
    'bottom-left', 'bottom-center', 'bottom-right',
  ];

  const POS_LABEL = {
    'top-left': '↖', 'top-center': '↑', 'top-right': '↗',
    'bottom-left': '↙', 'bottom-center': '↓', 'bottom-right': '↘',
  };

  const POS_STYLE = {
    'top-left':      'top:4mm;left:4mm',
    'top-center':    'top:4mm;left:50%;transform:translateX(-50%)',
    'top-right':     'top:4mm;right:4mm',
    'bottom-left':   'bottom:4mm;left:4mm',
    'bottom-center': 'bottom:4mm;left:50%;transform:translateX(-50%)',
    'bottom-right':  'bottom:4mm;right:4mm',
  };

  function imgHtml(img) {
    if (!img.data) return '';
    return `<img class="bib-img" style="${POS_STYLE[img.position]};width:${img.size}%" src="${img.data}" alt="">`;
  }

  // ── Bib card HTML ─────────────────────────────────────────────────────────
  // All four text elements are absolutely positioned; font sizes and vertical
  // positions come from config so the design step can adjust them live.
  function bibCardHtml(a) {
    const fs  = config.fontSizes || DEFAULT_FONT_SIZES;
    const pos = config.positions || DEFAULT_POSITIONS;
    const imgs = config.images.map(imgHtml).join('');
    return `
      <div class="bib-scale-wrap">
        <div class="bib-card">
          ${imgs}
          <div class="bib-event-name" style="font-size:${fs.eventName}pt;top:${pos.eventName}mm">${h(config.eventName)}</div>
          <div class="bib-number"     style="font-size:${fs.bibNumber}pt;top:${pos.bibNumber}mm">${h(a.bib)}</div>
          <div class="bib-name"       style="font-size:${fs.athleteName}pt;top:${pos.athleteName}mm">${h(a.first)} ${h(a.last)}</div>
          ${a.ageGender ? `<div class="bib-category" style="font-size:${fs.category}pt;top:${pos.category}mm">${h(config.includeDiscipline ? a.categoryLine : a.ageGender)}</div>` : ''}
        </div>
      </div>`;
  }

  // ── Image slot config HTML (config step — upload + position only) ─────────
  function imgSlotHtml(img, i) {
    const posButtons = POSITIONS.map(p =>
      `<button class="pos-btn${img.position === p ? ' pos-active' : ''}" data-i="${i}" data-p="${p}" title="${p}">${POS_LABEL[p]}</button>`
    ).join('');

    const dropContent = img.data
      ? `<img src="${img.data}" style="max-width:100%;max-height:72px;object-fit:contain">
         <button class="img-clear-btn" data-i="${i}" title="Remove image">✕</button>`
      : `<span class="img-drop-hint">Click or drop<br>an image here</span>`;

    return `
      <div class="img-slot">
        <div class="img-slot-label">Image ${i + 1}</div>
        <div class="${img.data ? 'img-drop img-has' : 'img-drop'}" data-i="${i}" id="bib-img-drop-${i}">
          ${dropContent}
          <input type="file" id="bib-img-file-${i}" class="bib-img-file" data-i="${i}" accept="image/*" style="display:none">
        </div>
        <div class="pos-grid">${posButtons}</div>
      </div>`;
  }

  // ── Design step helpers ───────────────────────────────────────────────────
  function sliderRowHtml(label, id, value, min, max, step, unit) {
    return `
      <div style="display:flex;align-items:center;gap:.65rem;margin-bottom:.65rem">
        <label for="${id}" style="font-size:.75rem;color:#475569;min-width:72px;flex-shrink:0">${label}</label>
        <input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${value}"
          style="flex:1;min-width:0;accent-color:#2563eb;cursor:pointer;padding:0;border:none">
        <span id="${id}-val" style="font-size:.75rem;color:#64748b;min-width:2rem;text-align:right">${value}${unit}</span>
      </div>`;
  }

  // Updates font sizes, vertical positions, and image sizes on the live bib
  // preview via direct DOM manipulation — no re-render, sliders are instantaneous.
  function updateLiveBib() {
    const card = document.querySelector('#live-bib-wrap .bib-card');
    if (!card) return;
    const fs  = config.fontSizes;
    const pos = config.positions;
    const eventEl = card.querySelector('.bib-event-name');
    const numEl   = card.querySelector('.bib-number');
    const nameEl  = card.querySelector('.bib-name');
    const catEl   = card.querySelector('.bib-category');
    if (eventEl) { eventEl.style.fontSize = fs.eventName + 'pt';   eventEl.style.top = pos.eventName + 'mm'; }
    if (numEl)   { numEl.style.fontSize   = fs.bibNumber + 'pt';   numEl.style.top   = pos.bibNumber + 'mm'; }
    if (nameEl)  { nameEl.style.fontSize  = fs.athleteName + 'pt'; nameEl.style.top  = pos.athleteName + 'mm'; }
    if (catEl)   { catEl.style.fontSize   = fs.category + 'pt';    catEl.style.top   = pos.category + 'mm'; }
    const imgEls = card.querySelectorAll('.bib-img');
    config.images.forEach((img, i) => {
      if (imgEls[i]) imgEls[i].style.width = img.size + '%';
    });
  }

  // ── View HTML ─────────────────────────────────────────────────────────────
  function htmlUpload() {
    return `
      <div class="card">
        <h2>Bib Printer</h2>
        <p class="subtitle">Upload a Vertical Life athlete export to generate printable A5 landscape bibs.</p>
        <div class="dropzone" id="bib-dz">
          <div class="dz-icon">🏷</div>
          <p><strong>Drop Vertical Life athlete export here</strong></p>
          <p class="text-sm" style="margin-top:.4rem">or <span class="link" id="bib-browse">browse for file</span></p>
          <p class="text-muted" style="margin-top:.75rem">CSV · semicolon-delimited</p>
          <input type="file" id="bib-file" accept=".csv,.txt">
        </div>
        <div id="bib-parse-status"></div>
      </div>`;
  }

  function htmlConfig() {
    return `
      <div class="card" id="bib-config-section">
        <h2>Configure Bibs</h2>
        <p class="subtitle">${h(fileName)} — ${athletes.length} athletes loaded</p>

        <div style="max-width:520px;margin-bottom:1.75rem">
          <label class="field-label req">Event name</label>
          <p class="text-muted" style="font-size:.78rem;margin:.2rem 0 .4rem">
            Appears centred at the top of every bib. Enter it manually — it is not stored in the export file.
          </p>
          <input type="text" id="bib-event-name" value="${h(config.eventName)}"
            placeholder="e.g. Australian Youth Championships 2025">
        </div>

        <div style="margin-bottom:1.75rem">
          <label style="display:flex;align-items:center;gap:.5rem;cursor:pointer;width:fit-content">
            <input type="checkbox" id="bib-include-discipline"${config.includeDiscipline ? ' checked' : ''}
              style="width:1rem;height:1rem;cursor:pointer;accent-color:#2563eb">
            <span class="field-label" style="margin:0">Include discipline on bib</span>
          </label>
          <p class="text-muted" style="font-size:.78rem;margin:.3rem 0 0 1.5rem">
            When checked, the category line shows e.g. <em>U17 Female · Lead &amp; Boulder</em>.
            When unchecked, only <em>U17 Female</em> is shown.
          </p>
        </div>

        <div>
          <div class="field-label" style="margin-bottom:.35rem">Images</div>
          <p class="text-muted" style="font-size:.78rem;margin-bottom:.9rem">
            Upload up to 3 images and choose a position for each. You will set their sizes on the next screen.
          </p>
          <div class="img-slots">
            ${config.images.map((img, i) => imgSlotHtml(img, i)).join('')}
          </div>
        </div>

        <div class="btn-row">
          <button class="btn btn-ghost" id="bib-back-upload">← Different file</button>
          <button class="btn btn-primary" id="bib-goto-design">Next: Bib design →</button>
        </div>
      </div>`;
  }

  function htmlDesign() {
    const fs  = config.fontSizes;
    const pos = config.positions;
    const sample = [...athletes].sort((a, b) => Number(a.bib) - Number(b.bib))[0]
      || { bib: '101', first: 'Sample', last: 'Athlete', categoryLine: 'U17 Female · Lead & Boulder' };

    const hasImages = config.images.some(img => img.data);

    const textSliders = [
      { key: 'eventName',   label: 'Event name',   min: 6,  max: 48,  step: 1, unit: 'pt' },
      { key: 'bibNumber',   label: 'Bib number',   min: 36, max: 250, step: 2, unit: 'pt' },
      { key: 'athleteName', label: 'Athlete name', min: 10, max: 60,  step: 1, unit: 'pt' },
      { key: 'category',    label: 'Category',     min: 7,  max: 36,  step: 1, unit: 'pt' },
    ].map(s => sliderRowHtml(s.label, `dfs-${s.key}`, fs[s.key], s.min, s.max, s.step, s.unit)).join('');

    const posSliders = [
      { key: 'eventName',   label: 'Event name'   },
      { key: 'bibNumber',   label: 'Bib number'   },
      { key: 'athleteName', label: 'Athlete name' },
      { key: 'category',    label: 'Category'     },
    ].map(s => sliderRowHtml(s.label, `dpos-${s.key}`, pos[s.key], 0, 140, 1, 'mm')).join('');

    const imgSliders = config.images.map((img, i) =>
      img.data ? sliderRowHtml(`Image ${i + 1}`, `dim-${i}`, img.size, 5, 65, 1, '%') : ''
    ).join('');

    return `
      <div class="card" id="bib-config-section" style="margin-bottom:1.5rem">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:.75rem">
          <div>
            <h2>Bib Design</h2>
            <p class="subtitle" style="margin:0">Drag the sliders to adjust sizes and positions on the live preview.</p>
          </div>
          <div style="display:flex;gap:.5rem;flex-wrap:wrap">
            <button class="btn btn-ghost" id="bib-back-config2">← Edit config</button>
            <button class="btn btn-primary" id="bib-goto-select">Select bibs →</button>
          </div>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:calc(210mm * 0.65) 1fr;gap:1.5rem;align-items:start">
        <div id="live-bib-wrap">
          ${bibCardHtml(sample)}
        </div>

        <div class="card">
          <div class="field-label" style="margin-bottom:.75rem">Text sizes</div>
          ${textSliders}

          <div class="field-label" style="margin-top:1.25rem;margin-bottom:.75rem">Vertical positions</div>
          <p class="text-muted" style="font-size:.75rem;margin-bottom:.65rem">Distance from top of bib in mm.</p>
          ${posSliders}

          ${hasImages ? `
            <div class="field-label" style="margin-top:1.25rem;margin-bottom:.75rem">Image sizes</div>
            ${imgSliders}
          ` : ''}
        </div>
      </div>`;
  }

  // ── Select ────────────────────────────────────────────────────────────────
  function visibleBibIds() {
    const bibs = [];
    document.querySelectorAll('#sel-table tbody tr').forEach(tr => {
      if (tr.style.display !== 'none') bibs.push(tr.dataset.bib);
    });
    return bibs;
  }

  function updateSelectCount() {
    const el = document.getElementById('sel-count');
    if (el) el.textContent = `${selectedBibs.size} of ${athletes.length} selected`;
  }

  function applySelectFilter() {
    const nameQ = selectFilterName.toLowerCase().trim();
    const catQ  = selectFilterCat;
    const discQ = selectFilterDisc.toLowerCase();
    document.querySelectorAll('#sel-table tbody tr').forEach(tr => {
      const matchCat  = !catQ  || tr.dataset.cat === catQ;
      const matchDisc = !discQ || tr.dataset.disc.split('|').includes(discQ);
      const matchName = !nameQ || tr.dataset.name.includes(nameQ);
      tr.style.display = (matchCat && matchDisc && matchName) ? '' : 'none';
    });
    updateSelectAllBtn();
  }

  function updateSelectAllBtn() {
    const btn = document.getElementById('sel-select-all');
    if (!btn) return;
    const isFiltered = selectFilterCat || selectFilterDisc || selectFilterName.trim();
    btn.textContent = isFiltered ? `Select visible (${visibleBibIds().length})` : 'Select all';
  }

  function htmlSelect() {
    const sorted = [...athletes].sort((a, b) => Number(a.bib) - Number(b.bib));
    const cats   = [...new Set(athletes.map(a => a.ageGender).filter(Boolean))].sort();
    const discs  = [...new Set(athletes.flatMap(a => a.disciplines))].sort();

    const catOptions = [
      '<option value="">All categories</option>',
      ...cats.map(c => `<option value="${h(c)}"${selectFilterCat === c ? ' selected' : ''}>${h(c)}</option>`),
    ].join('');

    const discOptions = [
      '<option value="">All disciplines</option>',
      ...discs.map(d => `<option value="${h(d)}"${selectFilterDisc === d ? ' selected' : ''}>${h(d)}</option>`),
    ].join('');

    const rows = sorted.map(a => `
      <tr data-bib="${h(a.bib)}"
          data-cat="${h(a.ageGender)}"
          data-disc="${h(a.disciplines.join('|').toLowerCase())}"
          data-name="${h((a.first + ' ' + a.last).toLowerCase())}">
        <td style="padding:.45rem .75rem;text-align:center">
          <input type="checkbox" class="sel-chk" data-bib="${h(a.bib)}"${selectedBibs.has(a.bib) ? ' checked' : ''}>
        </td>
        <td style="padding:.45rem .75rem">${h(a.bib)}</td>
        <td style="padding:.45rem .75rem">${h(a.first)} ${h(a.last)}</td>
        <td style="padding:.45rem .75rem">${h(a.ageGender)}</td>
        <td style="padding:.45rem .75rem">${h(a.disciplines.join(' & '))}</td>
      </tr>`).join('');

    return `
      <div class="card" style="margin-bottom:1.5rem">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:.75rem">
          <div>
            <h2>Select Bibs</h2>
            <p class="subtitle" style="margin:0"><span id="sel-count">${selectedBibs.size} of ${athletes.length} selected</span></p>
          </div>
          <div style="display:flex;gap:.5rem;flex-wrap:wrap">
            <button class="btn btn-ghost" id="bib-back-design2">← Edit design</button>
            <button class="btn btn-primary" id="bib-goto-preview">Preview selected →</button>
          </div>
        </div>
      </div>

      <div class="card">
        <div style="display:flex;align-items:center;gap:.65rem;flex-wrap:wrap;margin-bottom:1rem">
          <select id="sel-cat-filter" style="flex:1;min-width:140px">${catOptions}</select>
          <select id="sel-disc-filter" style="flex:1;min-width:130px">${discOptions}</select>
          <input type="text" id="sel-name-filter" placeholder="Search by name…"
            value="${h(selectFilterName)}" style="flex:1;min-width:150px">
          <button class="btn btn-ghost" id="sel-select-all"
            style="font-size:.8rem;padding:.3rem .75rem;white-space:nowrap">Select all</button>
          <button class="btn btn-ghost" id="sel-clear-all"
            style="font-size:.8rem;padding:.3rem .75rem;white-space:nowrap">Clear all</button>
        </div>

        <div style="overflow-x:auto">
          <table id="sel-table" style="width:100%;border-collapse:collapse;font-size:.875rem">
            <thead>
              <tr style="border-bottom:2px solid #e2e8f0;text-align:left">
                <th style="padding:.45rem .75rem;width:2.5rem"></th>
                <th style="padding:.45rem .75rem">Bib #</th>
                <th style="padding:.45rem .75rem">Name</th>
                <th style="padding:.45rem .75rem">Category</th>
                <th style="padding:.45rem .75rem">Discipline</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>`;
  }

  function bindSelect() {
    document.getElementById('bib-back-design2').addEventListener('click', () => { view = 'design'; render(); });

    document.getElementById('bib-goto-preview').addEventListener('click', () => {
      if (!selectedBibs.size) { alert('Please select at least one bib to preview.'); return; }
      view = 'preview';
      render();
    });

    const catFilter  = document.getElementById('sel-cat-filter');
    const discFilter = document.getElementById('sel-disc-filter');
    const nameFilter = document.getElementById('sel-name-filter');

    catFilter.addEventListener('change', () => {
      selectFilterCat = catFilter.value;
      applySelectFilter();
    });
    discFilter.addEventListener('change', () => {
      selectFilterDisc = discFilter.value;
      applySelectFilter();
    });
    nameFilter.addEventListener('input', () => {
      selectFilterName = nameFilter.value;
      applySelectFilter();
    });

    applySelectFilter();

    document.getElementById('sel-select-all').addEventListener('click', () => {
      visibleBibIds().forEach(bib => selectedBibs.add(bib));
      document.querySelectorAll('#sel-table tbody tr').forEach(tr => {
        if (tr.style.display !== 'none') tr.querySelector('.sel-chk').checked = true;
      });
      updateSelectCount();
    });

    document.getElementById('sel-clear-all').addEventListener('click', () => {
      selectedBibs.clear();
      document.querySelectorAll('.sel-chk').forEach(chk => { chk.checked = false; });
      updateSelectCount();
    });

    document.querySelectorAll('.sel-chk').forEach(chk => {
      chk.addEventListener('change', () => {
        if (chk.checked) selectedBibs.add(chk.dataset.bib);
        else selectedBibs.delete(chk.dataset.bib);
        updateSelectCount();
      });
    });
  }

  function htmlPreview() {
    const sorted = athletes
      .filter(a => selectedBibs.has(a.bib))
      .sort((a, b) => Number(a.bib) - Number(b.bib));
    return `
      <div class="card" id="bib-config-section" style="margin-bottom:1.5rem">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:.75rem">
          <div>
            <h2>Bib Preview</h2>
            <p class="subtitle" style="margin:0">${sorted.length} bib${sorted.length === 1 ? '' : 's'} · ${h(config.eventName)}</p>
          </div>
          <div style="display:flex;gap:.5rem;flex-wrap:wrap">
            <button class="btn btn-ghost" id="bib-back-select">← Edit selection</button>
            <button class="btn btn-primary" id="bib-print">🖨 Print bibs</button>
          </div>
        </div>
        <p style="font-size:.82rem;color:#475569;margin:.6rem 0 0">
          Tip: in the print dialog, set the destination to <strong>Save as PDF</strong>
          to save a file — then print from the PDF whenever needed.
        </p>
      </div>
      <div id="bib-cards">
        ${sorted.map(a => bibCardHtml(a)).join('')}
      </div>`;
  }

  // ── Render & bind ─────────────────────────────────────────────────────────
  function render() {
    const el = document.getElementById('bib-content');
    if (!el) return;
    if (view === 'upload')  el.innerHTML = htmlUpload();
    if (view === 'config')  el.innerHTML = htmlConfig();
    if (view === 'design')  el.innerHTML = htmlDesign();
    if (view === 'select')  el.innerHTML = htmlSelect();
    if (view === 'preview') el.innerHTML = htmlPreview();
    bindView();
  }

  function bindView() {
    if (view === 'upload')  bindUpload();
    if (view === 'config')  bindConfig();
    if (view === 'design')  bindDesign();
    if (view === 'select')  bindSelect();
    if (view === 'preview') bindPreview();
  }

  // ── Upload ────────────────────────────────────────────────────────────────
  function bindUpload() {
    const dz    = document.getElementById('bib-dz');
    const input = document.getElementById('bib-file');
    document.getElementById('bib-browse').addEventListener('click', () => input.click());
    input.addEventListener('change', () => { if (input.files[0]) loadFile(input.files[0]); });
    dz.addEventListener('dragover',  e => { e.preventDefault(); dz.classList.add('over'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('over'));
    dz.addEventListener('drop', e => {
      e.preventDefault(); dz.classList.remove('over');
      if (e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]);
    });
  }

  function loadFile(file) {
    const status = document.getElementById('bib-parse-status');
    if (status) {
      status.innerHTML = `<div class="alert alert-info"><span class="spin"></span> Parsing <strong>${h(file.name)}</strong>…</div>`;
    }
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const parsed = parseBibCsv(e.target.result);
        if (!parsed.length) {
          if (status) status.innerHTML = `<div class="alert alert-warning">No athlete rows found. Make sure this is a Vertical Life export with semicolon delimiters and a <em>bib</em> column.</div>`;
          return;
        }
        athletes         = parsed;
        fileName         = file.name;
        selectedBibs     = new Set();
        selectFilterCat  = '';
        selectFilterDisc = '';
        selectFilterName = '';
        view = 'config';
        render();
      } catch (err) {
        if (status) status.innerHTML = `<div class="alert alert-warning">❌ ${h(err.message)}</div>`;
      }
    };
    reader.readAsText(file);
  }

  // ── Config ────────────────────────────────────────────────────────────────
  function bindConfig() {
    document.getElementById('bib-back-upload').addEventListener('click', () => { view = 'upload'; render(); });

    document.getElementById('bib-goto-design').addEventListener('click', () => {
      const name = document.getElementById('bib-event-name').value.trim();
      if (!name) { alert('Please enter the event name — it appears at the top of every bib.'); return; }
      config.eventName         = name;
      config.includeDiscipline = document.getElementById('bib-include-discipline').checked;
      saveConfig();
      view = 'design';
      render();
    });

    // Image drop areas
    config.images.forEach((_, i) => {
      const drop  = document.getElementById(`bib-img-drop-${i}`);
      const input = document.getElementById(`bib-img-file-${i}`);
      if (!drop || !input) return;
      drop.addEventListener('click', e => {
        if (e.target.classList.contains('img-clear-btn')) return;
        input.click();
      });
      drop.addEventListener('dragover',  e => { e.preventDefault(); drop.classList.add('over'); });
      drop.addEventListener('dragleave', () => drop.classList.remove('over'));
      drop.addEventListener('drop', e => {
        e.preventDefault(); drop.classList.remove('over');
        if (e.dataTransfer.files[0]) loadImage(e.dataTransfer.files[0], i);
      });
      input.addEventListener('change', () => { if (input.files[0]) loadImage(input.files[0], i); });
    });

    document.querySelectorAll('.img-clear-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        config.images[Number(btn.dataset.i)].data = null;
        saveConfig(); render();
      });
    });

    document.querySelectorAll('.pos-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        config.images[Number(btn.dataset.i)].position = btn.dataset.p;
        saveConfig();
        btn.closest('.pos-grid').querySelectorAll('.pos-btn').forEach(b =>
          b.classList.toggle('pos-active', b === btn)
        );
      });
    });
  }

  function loadImage(file, idx) {
    const reader = new FileReader();
    reader.onload = e => {
      config.images[idx].data = e.target.result;
      saveConfig(); render();
    };
    reader.readAsDataURL(file);
  }

  // ── Design ────────────────────────────────────────────────────────────────
  function bindDesign() {
    document.getElementById('bib-back-config2').addEventListener('click', () => { view = 'config'; render(); });
    document.getElementById('bib-goto-select').addEventListener('click', () => {
      saveConfig();
      selectedBibs     = new Set();
      selectFilterCat  = '';
      selectFilterDisc = '';
      selectFilterName = '';
      view = 'select';
      render();
    });

    // Text size sliders
    const textDefs = [
      { key: 'eventName',   unit: 'pt' },
      { key: 'bibNumber',   unit: 'pt' },
      { key: 'athleteName', unit: 'pt' },
      { key: 'category',    unit: 'pt' },
    ];
    textDefs.forEach(({ key, unit }) => {
      const slider = document.getElementById(`dfs-${key}`);
      const valEl  = document.getElementById(`dfs-${key}-val`);
      if (!slider) return;
      slider.addEventListener('input', () => {
        config.fontSizes[key] = Number(slider.value);
        if (valEl) valEl.textContent = slider.value + unit;
        updateLiveBib();
        saveConfig();
      });
    });

    // Vertical position sliders
    ['eventName', 'bibNumber', 'athleteName', 'category'].forEach(key => {
      const slider = document.getElementById(`dpos-${key}`);
      const valEl  = document.getElementById(`dpos-${key}-val`);
      if (!slider) return;
      slider.addEventListener('input', () => {
        config.positions[key] = Number(slider.value);
        if (valEl) valEl.textContent = slider.value + 'mm';
        updateLiveBib();
        saveConfig();
      });
    });

    // Image size sliders (only present if the image has data)
    config.images.forEach((img, i) => {
      if (!img.data) return;
      const slider = document.getElementById(`dim-${i}`);
      const valEl  = document.getElementById(`dim-${i}-val`);
      if (!slider) return;
      slider.addEventListener('input', () => {
        config.images[i].size = Number(slider.value);
        if (valEl) valEl.textContent = slider.value + '%';
        updateLiveBib();
        saveConfig();
      });
    });
  }

  // ── Preview ───────────────────────────────────────────────────────────────
  function bindPreview() {
    document.getElementById('bib-back-select').addEventListener('click', () => { view = 'select'; render(); });
    document.getElementById('bib-print').addEventListener('click', () => {
      const prev = document.title;
      const n = selectedBibs.size;
      document.title = config.eventName
        ? `${config.eventName} - ${n} Bib${n === 1 ? '' : 's'}`
        : `${n} Bib${n === 1 ? '' : 's'}`;
      window.print();
      window.addEventListener('afterprint', () => { document.title = prev; }, { once: true });
    });
  }

  // ── Mode switching ────────────────────────────────────────────────────────
  function exitBibs() {
    document.getElementById('bib-content').style.display = 'none';
    document.getElementById('content').style.display     = '';
    App.goTo(0);
  }

  // ── Public API ────────────────────────────────────────────────────────────
  function init() {
    // Replace step nav with bib mode indicator + home button
    document.getElementById('step-nav').innerHTML = `
      <div style="flex:1;display:flex;align-items:center;gap:.65rem;padding:0 .5rem">
        <button id="bib-nav-home" style="
          background:rgba(255,255,255,.15);border:1px solid rgba(255,255,255,.3);
          color:#fff;border-radius:.375rem;padding:.25rem .65rem;
          font-size:.78rem;cursor:pointer;white-space:nowrap">← Home</button>
        <span style="color:rgba(255,255,255,.7);font-size:.88rem;font-weight:600">Bib Printer</span>
      </div>`;
    document.getElementById('bib-nav-home').addEventListener('click', exitBibs);

    document.getElementById('content').style.display     = 'none';
    document.getElementById('bib-content').style.display = '';

    if (!['config', 'design', 'select', 'preview'].includes(view)) view = 'upload';
    render();
  }

  return { init };
})();
