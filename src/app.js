/* global Parser, Transformer, Exporter, XLSX, Papa, JSZip */
(() => {

  // ── State ──────────────────────────────────────────────────────────────────
  const state = {
    step: 1,
    fileName: '',
    headers: [],
    rows: [],
    fingerprint: '',

    columnMap: {
      firstName: '', lastName: '', gender: '',
      dob: '', state: '', category: '',
    },

    // Each filter: { column, mode:'values'|'contains', excluded:[], contains:'', caseSensitive:false }
    filters: [],

    multiDiscipline: false,
    disciplineFixed: '',
    disciplineColumn: '',
    disciplineRules: [],

    categoryConfig: {},
    outputFiles: [],
  };

  // ── localStorage ───────────────────────────────────────────────────────────
  const lsKey = (prefix, fp) => `wa_vl_${prefix}_${fp}`;

  function lsSave(prefix, fp, value) {
    try { localStorage.setItem(lsKey(prefix, fp), JSON.stringify(value)); } catch {}
  }
  function lsLoad(prefix, fp) {
    try { return JSON.parse(localStorage.getItem(lsKey(prefix, fp))); } catch { return null; }
  }

  function saveColumnSettings() {
    const fp = state.fingerprint;
    lsSave('colmap', fp, state.columnMap);
    lsSave('disc', fp, {
      multiDiscipline:  state.multiDiscipline,
      disciplineFixed:  state.disciplineFixed,
      disciplineColumn: state.disciplineColumn,
      disciplineRules:  state.disciplineRules,
    });
  }

  function loadColumnSettings() {
    const fp  = state.fingerprint;
    const map = lsLoad('colmap', fp);
    if (map) {
      for (const k of Object.keys(state.columnMap)) {
        if (map[k] !== undefined && (map[k] === '' || state.headers.includes(map[k]))) {
          state.columnMap[k] = map[k];
        }
      }
    }
    const disc = lsLoad('disc', fp);
    if (disc) {
      state.multiDiscipline  = disc.multiDiscipline  ?? false;
      state.disciplineFixed  = disc.disciplineFixed  ?? '';
      state.disciplineColumn = state.headers.includes(disc.disciplineColumn) ? disc.disciplineColumn : '';
      state.disciplineRules  = Array.isArray(disc.disciplineRules) ? disc.disciplineRules : [];
    }
  }

  function saveFilters() {
    lsSave('filters', state.fingerprint, state.filters);
  }

  function loadFilters() {
    const saved = lsLoad('filters', state.fingerprint);
    if (!saved || !Array.isArray(saved)) return;
    state.filters = saved
      .filter(f => !f.column || state.headers.includes(f.column))
      .map(f => normaliseFilter(f));
  }

  function normaliseFilter(f = {}) {
    return {
      column:        f.column        || '',
      mode:          ['contains', 'blank'].includes(f.mode) ? f.mode : 'values',
      excluded:      Array.isArray(f.excluded) ? f.excluded : [],
      contains:      f.contains      || '',
      caseSensitive: f.caseSensitive || false,
    };
  }

  function saveCategoryConfig() {
    lsSave('catconf', state.fingerprint, state.categoryConfig);
  }

  function loadCategoryConfig() {
    const saved = lsLoad('catconf', state.fingerprint);
    if (saved) state.categoryConfig = saved;
  }

  function hasSavedColumnMap() {
    return localStorage.getItem(lsKey('colmap', state.fingerprint)) !== null;
  }

  // ── Auto-detect column mapping ─────────────────────────────────────────────
  const HINTS = {
    firstName: ['first name', 'firstname', 'given name', 'given'],
    lastName:  ['last name', 'lastname', 'surname', 'family name', 'family'],
    gender:    ['gender identifier', 'gender', 'sex'],
    dob:       ['date of birth', 'dob', 'birth date', 'birthdate'],
    state:     ['state of affiliation', 'state', 'affiliation', 'region'],
    category:  ['category', 'age group', 'division', 'age category'],
  };

  function autoDetect(headers) {
    const result = {};
    for (const [field, hints] of Object.entries(HINTS)) {
      result[field] = headers.find(hdr =>
        hints.some(hint => hdr.toLowerCase().includes(hint))
      ) || '';
    }
    return result;
  }

  // ── Filter helpers ─────────────────────────────────────────────────────────
  const EXCLUDE_WORDS = ['cancel', 'declined', 'rejected', 'refund', 'void', 'unpaid'];

  function autoExcluded(colName) {
    if (!colName) return [];
    return Transformer.getUniqueValues(state.rows, colName)
      .filter(v => EXCLUDE_WORDS.some(w => v.toLowerCase().includes(w)));
  }

  function ensureDefaultFilter() {
    if (state.filters.length > 0) return;
    const payCol = state.headers.find(h =>
      h.toLowerCase().includes('payment state') || h.toLowerCase().includes('payment status')
    ) || '';
    state.filters = [normaliseFilter({ column: payCol, excluded: autoExcluded(payCol) })];
  }

  function getFilteredRows() {
    return state.rows.filter(row => Transformer.isRowIncluded(row, state));
  }

  function countContainsMatches(filter) {
    if (!filter.column || !filter.contains) return 0;
    const needle = filter.caseSensitive ? filter.contains : filter.contains.toLowerCase();
    return state.rows.filter(row => {
      const val      = String(row[filter.column] ?? '').trim();
      const haystack = filter.caseSensitive ? val : val.toLowerCase();
      return haystack.includes(needle);
    }).length;
  }

  function countBlankMatches(filter) {
    if (!filter.column) return 0;
    return state.rows.filter(row => String(row[filter.column] ?? '').trim() === '').length;
  }

  // Returns excluded rows with the first matching filter's reason
  function getExcludedRowsWithReasons() {
    const result = [];
    for (const row of state.rows) {
      for (const f of state.filters) {
        if (!f.column) continue;
        const val  = String(row[f.column] ?? '').trim();
        const mode = f.mode || 'values';
        let excluded = false;
        let reason   = val;

        if (mode === 'blank' && val === '') {
          excluded = true;
          reason   = 'blank';
        } else if (mode === 'contains' && f.contains) {
          const haystack = f.caseSensitive ? val : val.toLowerCase();
          const needle   = f.caseSensitive ? f.contains : f.contains.toLowerCase();
          if (haystack.includes(needle)) {
            excluded = true;
            reason   = `contains "${f.contains}"${f.caseSensitive ? ' (case sensitive)' : ''}`;
          }
        } else if (mode === 'values' && f.excluded.includes(val)) {
          excluded = true;
        }

        if (excluded) {
          result.push({ row, column: f.column, reason });
          break;
        }
      }
    }
    return result;
  }

  function excludedPreviewHtml() {
    const excluded = getExcludedRowsWithReasons();
    if (!excluded.length) {
      return '<p class="text-muted" style="padding:.5rem 0">No rows are currently excluded.</p>';
    }
    const cm   = state.columnMap;
    const rows = excluded.map(({ row, column, reason }) => `
      <tr>
        <td>${h(String(row[cm.firstName] ?? ''))} ${h(String(row[cm.lastName] ?? ''))}</td>
        <td class="text-muted">${h(String(row[cm.category] ?? '') || '—')}</td>
        <td><span class="excl-reason-col">${h(column)}:</span> <strong>${h(reason) || '<em>(blank)</em>'}</strong></td>
      </tr>`).join('');
    return `
      <table class="map-table excl-preview-table">
        <thead><tr><th>Name</th><th>Category</th><th>Excluded because</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  // ── Category auto-config ───────────────────────────────────────────────────
  const OFFICIAL_WORDS = ['coach', 'manager', 'official', 'staff', 'volunteer', 'judge'];

  function autoConfigCategories(values) {
    const conf = {};
    for (const val of values) {
      if (state.categoryConfig[val]) { conf[val] = state.categoryConfig[val]; continue; }
      if (val === '') { conf[val] = { label: 'Blank', type: 'exclude' }; continue; }
      const lower    = val.toLowerCase();
      const isOfficial = OFFICIAL_WORDS.some(w => lower.includes(w));
      const ageMatch   = val.match(/^(U\d+|Open|Senior|Elite|Junior|Masters?)\b/i);
      const label      = ageMatch ? ageMatch[1] : val.replace(/\s*\(.*\)/, '').trim();
      conf[val] = { label, type: isOfficial ? 'official' : 'athlete' };
    }
    return conf;
  }

  // ── Navigation ─────────────────────────────────────────────────────────────
  const STEPS = [
    { n: 1, label: 'Upload'     },
    { n: 2, label: 'Columns'    },
    { n: 3, label: 'Filters'    },
    { n: 4, label: 'Discipline' },
    { n: 5, label: 'Categories' },
    { n: 6, label: 'Export'     },
  ];

  function goTo(n) {
    state.step = n;
    renderNav();
    renderStep();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function renderNav() {
    const nav = document.getElementById('step-nav');
    if (state.step === 0) { nav.innerHTML = ''; return; }
    nav.innerHTML = STEPS.map(s => `
      <div class="step-item ${s.n === state.step ? 'active' : s.n < state.step ? 'done' : ''}">
        <span class="step-num">${s.n < state.step ? '✓' : s.n}</span>
        <span class="step-label">${s.label}</span>
      </div>`).join('');
  }

  function h(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function renderStep() {
    const el = document.getElementById('content');
    el.innerHTML    = '';
    el.style.display = '';
    // Always hide bib panel when rendering CSV export steps or home screen
    const bibEl = document.getElementById('bib-content');
    if (bibEl) bibEl.style.display = 'none';
    switch (state.step) {
      case 0: el.innerHTML = html0(); bind0(); break;
      case 1: el.innerHTML = html1(); bind1(); break;
      case 2: el.innerHTML = html2(); bind2(); break;
      case 3: el.innerHTML = html3(); bind3(); break;
      case 4: el.innerHTML = html4(); bind4(); break;
      case 5: el.innerHTML = html5(); bind5(); break;
      case 6: el.innerHTML = html6(); bind6(); break;
    }
  }

  // ── Step 0 — Home screen ───────────────────────────────────────────────────
  function html0() {
    return `
      <div style="text-align:center;margin-bottom:2rem;padding-top:.25rem">
        <p class="subtitle" style="margin:0">Choose a tool to get started</p>
      </div>
      <div class="home-grid">
        <div class="feature-card" id="home-export">
          <span class="feature-icon">📋</span>
          <h3>CSV Export</h3>
          <p>Convert Wild Apricot registration exports into Vertical Life athlete import files.</p>
          <button class="btn btn-primary" style="pointer-events:none">Open tool →</button>
        </div>
        <div class="feature-card" id="home-bibs">
          <span class="feature-icon">🏷</span>
          <h3>Bib Printer</h3>
          <p>Generate printable A5 landscape bibs from a Vertical Life athlete export.</p>
          <button class="btn btn-primary" style="pointer-events:none">Open tool →</button>
        </div>
      </div>`;
  }

  function bind0() {
    document.getElementById('home-export').addEventListener('click', () => goTo(1));
    document.getElementById('home-bibs').addEventListener('click', () => Bibs.init());
  }

  // ── Step 1 — Upload ────────────────────────────────────────────────────────
  function html1() {
    return `
      <div class="card">
        <h2>Upload Wild Apricot Export</h2>
        <p class="subtitle">Drop your registration export below — XLS, XLSX, or CSV accepted.</p>
        <div class="dropzone" id="dropzone">
          <div class="dz-icon">📂</div>
          <p><strong>Drag &amp; drop your file here</strong></p>
          <p class="text-sm" style="margin-top:.4rem">or <label class="link">browse<input type="file" id="file-input" accept=".xls,.xlsx,.csv"></label></p>
          <p class="text-muted" style="margin-top:.75rem">XLS · XLSX · CSV</p>
        </div>
        <div id="parse-status"></div>
      </div>`;
  }

  function bind1() {
    const dz = document.getElementById('dropzone');
    const fi = document.getElementById('file-input');
    dz.addEventListener('dragover',  e => { e.preventDefault(); dz.classList.add('over'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('over'));
    dz.addEventListener('drop', e => {
      e.preventDefault(); dz.classList.remove('over');
      if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
    });
    fi.addEventListener('change', () => { if (fi.files[0]) handleFile(fi.files[0]); });
  }

  async function handleFile(file) {
    const status = document.getElementById('parse-status');
    status.innerHTML = `<div class="alert alert-info"><span class="spin"></span> Parsing <strong>${h(file.name)}</strong>…</div>`;
    try {
      const { headers, rows } = await Parser.parseFile(file);
      state.fileName    = file.name;
      state.headers     = headers;
      state.rows        = rows;
      state.fingerprint = Parser.hashHeaders(headers);

      state.columnMap = autoDetect(headers);
      state.filters   = [];
      loadColumnSettings();
      loadFilters();
      loadCategoryConfig();

      status.innerHTML = `<div class="alert alert-success">✓ Parsed <strong>${rows.length} rows</strong> · <strong>${headers.length} columns</strong></div>`;
      setTimeout(() => goTo(2), 700);
    } catch (err) {
      status.innerHTML = `<div class="alert alert-warning">❌ ${h(err.message)}</div>`;
    }
  }

  // ── Step 2 — Column mapping ────────────────────────────────────────────────
  const COL_FIELDS = [
    { key: 'firstName', label: 'First Name',           req: true },
    { key: 'lastName',  label: 'Last Name',            req: true },
    { key: 'gender',    label: 'Gender',               req: true },
    { key: 'dob',       label: 'Date of Birth',        req: true },
    { key: 'state',     label: 'State / Affiliation',  req: true },
    { key: 'category',  label: 'Category (age group)', req: true },
  ];

  function headerSelect(fieldKey, required) {
    const cur  = state.columnMap[fieldKey];
    const none = required ? '— select —' : '— not mapped —';
    return `<select data-field="${fieldKey}">
      <option value="">${none}</option>
      ${state.headers.map(hdr =>
        `<option value="${h(hdr)}" ${hdr === cur ? 'selected' : ''}>${h(hdr)}</option>`
      ).join('')}
    </select>`;
  }

  function previewCell(fieldKey) {
    const col = state.columnMap[fieldKey];
    return col && state.rows[0] ? h(String(state.rows[0][col] ?? '')) : '';
  }

  function html2() {
    const savedBanner = hasSavedColumnMap()
      ? `<div class="alert alert-info" style="margin-bottom:1rem">✓ Loaded saved mapping for this export format.</div>`
      : '';
    const rows = COL_FIELDS.map(f => `
      <tr>
        <td class="${f.req ? 'req' : ''}">${f.label}</td>
        <td>${headerSelect(f.key, f.req)}</td>
        <td class="text-muted preview-cell" data-field="${f.key}">${previewCell(f.key)}</td>
      </tr>`).join('');
    return `
      <div class="card">
        <h2>Map Columns</h2>
        <p class="subtitle">Match each Vertical Life field to the correct column in your export. Preview shows the first data row.</p>
        ${savedBanner}
        <table class="map-table">
          <thead><tr><th>Vertical Life field</th><th>Wild Apricot column</th><th>Preview (row 1)</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <div class="btn-row">
          <button class="btn btn-ghost" onclick="App.goTo(1)">← Back</button>
          <button class="btn btn-ghost" id="s2-preview">Preview source data</button>
          <button class="btn btn-primary" id="s2-next">Continue →</button>
        </div>
      </div>`;
  }

  function bind2() {
    document.getElementById('s2-preview').addEventListener('click', openDataPreview);
    document.querySelectorAll('select[data-field]').forEach(sel => {
      sel.addEventListener('change', () => {
        state.columnMap[sel.dataset.field] = sel.value;
        const pc = document.querySelector(`.preview-cell[data-field="${sel.dataset.field}"]`);
        if (pc) pc.textContent = sel.value && state.rows[0] ? String(state.rows[0][sel.value] ?? '') : '';
      });
    });
    document.getElementById('s2-next').addEventListener('click', () => {
      const missing = COL_FIELDS.filter(f => f.req && !state.columnMap[f.key]).map(f => f.label);
      if (missing.length) { alert(`Please map: ${missing.join(', ')}`); return; }
      saveColumnSettings();
      goTo(3);
    });
  }

  // ── Step 3 — Filters ───────────────────────────────────────────────────────

  // Value-checkbox panel (mode = 'values')
  function filterValuePanelHtml(filter, idx) {
    if (!filter.column) return '';
    const counts    = Transformer.getValueCounts(state.rows, filter.column);
    const exclCount = Object.entries(counts)
      .filter(([v]) => filter.excluded.includes(v))
      .reduce((s, [, c]) => s + c, 0);

    const checkboxes = Object.entries(counts)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([val, count]) => {
        const isExcl  = filter.excluded.includes(val);
        const autoTag = EXCLUDE_WORDS.some(w => val.toLowerCase().includes(w))
          ? `<span class="badge badge-red">auto</span>` : '';
        return `
          <label class="check-label ${isExcl ? 'is-excluded' : ''}">
            <input type="checkbox" class="excl-check" data-idx="${idx}" data-val="${h(val)}" ${isExcl ? 'checked' : ''}>
            <span class="check-val">${val === '' ? '<em class="text-muted">(blank)</em>' : h(val)}</span>
            ${autoTag}
            <span class="check-count">${count} row${count !== 1 ? 's' : ''}</span>
          </label>`;
      }).join('');

    return `
      <p class="field-label" style="margin-bottom:.5rem">Exclude rows where value is:</p>
      <div class="filter-checks">${checkboxes}</div>
      <p class="filter-excl-summary values-summary" data-idx="${idx}">
        ${summaryText(exclCount)}
      </p>`;
  }

  // Contains-text panel (mode = 'contains')
  function filterContainsPanelHtml(filter, idx) {
    const matchCount = countContainsMatches(filter);
    return `
      <p class="field-label" style="margin-bottom:.5rem">Exclude rows where value contains:</p>
      <div style="max-width:300px">
        <input type="text" class="contains-input" data-idx="${idx}"
          placeholder='e.g. Special entry' value="${h(filter.contains)}">
      </div>
      <label class="check-label" style="margin-top:.6rem;display:inline-flex">
        <input type="checkbox" class="case-sens-check" data-idx="${idx}" ${filter.caseSensitive ? 'checked' : ''}>
        Case sensitive
      </label>
      <p class="filter-excl-summary contains-summary" data-idx="${idx}" style="margin-top:.4rem">
        ${containsSummaryText(filter, matchCount)}
      </p>`;
  }

  function filterBlankPanelHtml(filter, idx) {
    const n = countBlankMatches(filter);
    const summary = n > 0
      ? `<strong>${n}</strong> row${n !== 1 ? 's' : ''} have a blank ${h(filter.column)} and will be excluded`
      : '<span class="text-muted">No rows have a blank value in this column</span>';
    return `<p class="filter-excl-summary" style="margin-top:.25rem">${summary}</p>`;
  }

  // Mode selector + all three panels
  function filterBodyHtml(filter, idx) {
    if (!filter.column) return '';
    const mode = filter.mode;
    return `
      <div class="filter-mode-row">
        <span class="field-label" style="margin:0 .6rem 0 0">Match type:</span>
        <label class="radio-inline">
          <input type="radio" name="fmode-${idx}" class="filter-mode-radio" data-idx="${idx}"
            value="values" ${mode === 'values' ? 'checked' : ''}> By value
        </label>
        <label class="radio-inline">
          <input type="radio" name="fmode-${idx}" class="filter-mode-radio" data-idx="${idx}"
            value="contains" ${mode === 'contains' ? 'checked' : ''}> Contains text
        </label>
        <label class="radio-inline">
          <input type="radio" name="fmode-${idx}" class="filter-mode-radio" data-idx="${idx}"
            value="blank" ${mode === 'blank' ? 'checked' : ''}> Is blank
        </label>
      </div>
      <div id="fpanel-values-${idx}" ${mode !== 'values' ? 'style="display:none"' : ''}>
        ${filterValuePanelHtml(filter, idx)}
      </div>
      <div id="fpanel-contains-${idx}" ${mode !== 'contains' ? 'style="display:none"' : ''}>
        ${filterContainsPanelHtml(filter, idx)}
      </div>
      <div id="fpanel-blank-${idx}" ${mode !== 'blank' ? 'style="display:none"' : ''}>
        ${filterBlankPanelHtml(filter, idx)}
      </div>`;
  }

  function filterCardHtml(filter, idx) {
    const canRemove = state.filters.length > 1;
    const colOpts   = state.headers.map(hdr =>
      `<option value="${h(hdr)}" ${hdr === filter.column ? 'selected' : ''}>${h(hdr)}</option>`
    ).join('');

    return `
      <div class="filter-card" data-idx="${idx}">
        <div class="filter-card-head">
          <span class="filter-card-title">Filter ${idx + 1}</span>
          ${canRemove ? `<button class="btn btn-ghost btn-sm filter-remove" data-idx="${idx}">Remove</button>` : ''}
        </div>
        <div class="filter-card-body">
          <label class="field-label">Column to filter on</label>
          <div style="max-width:320px;margin-top:.35rem">
            <select class="filter-col-sel" data-idx="${idx}">
              <option value="">— select column —</option>
              ${colOpts}
            </select>
          </div>
          <div id="fbody-${idx}" style="margin-top:1rem">${filterBodyHtml(filter, idx)}</div>
        </div>
      </div>`;
  }

  function summaryText(n) {
    return n > 0
      ? `<strong>${n}</strong> row${n !== 1 ? 's' : ''} excluded by this filter`
      : '<span class="text-muted">No rows excluded by this filter</span>';
  }

  function containsSummaryText(filter, n) {
    if (!filter.contains) return '<span class="text-muted">Enter text above to preview matches</span>';
    return n > 0
      ? `<strong>${n}</strong> row${n !== 1 ? 's' : ''} excluded by this filter`
      : '<span class="text-muted">No rows match — nothing will be excluded</span>';
  }

  function html3() {
    ensureDefaultFilter();

    const totalRows    = state.rows.length;
    const includedRows = getFilteredRows().length;
    const excCount     = totalRows - includedRows;
    const cards        = state.filters.map((f, i) => filterCardHtml(f, i)).join('');

    return `
      <div class="card">
        <h2>Filters</h2>
        <p class="subtitle">
          Exclude registrations based on field values. Each filter uses
          <em>By value</em> (exact match checkboxes), <em>Contains text</em> (substring match),
          or <em>Is blank</em> (empty field). A row is excluded if it matches <em>any</em> filter.
        </p>

        <div class="filter-total-bar">
          <span class="filter-total-num" id="filter-total">${includedRows}</span> of
          <span class="filter-total-num">${totalRows}</span> rows will be exported
          <span class="filter-excl-badge" id="filter-excl-badge" ${excCount === 0 ? 'style="display:none"' : ''}>${excCount} excluded</span>
          <button class="btn-toggle-excl" id="toggle-excl" ${excCount === 0 ? 'style="display:none"' : ''}>Show excluded ▾</button>
        </div>

        <div id="filter-cards">${cards}</div>

        <button class="btn btn-ghost" id="add-filter" style="margin-top:.75rem">+ Add filter</button>

        <div class="excl-preview-section" id="excl-section" style="display:none">
          <div class="excl-preview-inner" id="excl-preview"></div>
        </div>

        <div class="btn-row">
          <button class="btn btn-ghost" onclick="App.goTo(2)">← Back</button>
          <button class="btn btn-primary" id="s3-next">Continue →</button>
        </div>
      </div>`;
  }

  // ── Live update helpers ────────────────────────────────────────────────────

  function updateFilterTotals() {
    const included  = getFilteredRows().length;
    const excCount  = state.rows.length - included;

    const totalEl = document.getElementById('filter-total');
    if (totalEl) totalEl.textContent = included;

    const badge = document.getElementById('filter-excl-badge');
    if (badge) { badge.textContent = `${excCount} excluded`; badge.style.display = excCount > 0 ? '' : 'none'; }

    const btn     = document.getElementById('toggle-excl');
    const section = document.getElementById('excl-section');
    if (btn && section) {
      btn.style.display = excCount > 0 ? '' : 'none';
      const isOpen = section.style.display !== 'none';
      btn.textContent = isOpen ? 'Hide excluded ▴' : 'Show excluded ▾';
      if (isOpen) {
        const preview = document.getElementById('excl-preview');
        if (preview) preview.innerHTML = excludedPreviewHtml();
      }
    }
  }

  function updateValuesSummary(idx) {
    const f = state.filters[idx];
    if (!f || !f.column) return;
    const counts    = Transformer.getValueCounts(state.rows, f.column);
    const exclCount = Object.entries(counts)
      .filter(([v]) => f.excluded.includes(v))
      .reduce((s, [, c]) => s + c, 0);
    const el = document.querySelector(`.values-summary[data-idx="${idx}"]`);
    if (el) el.innerHTML = summaryText(exclCount);
    updateFilterTotals();
  }

  function updateContainsSummary(idx) {
    const f = state.filters[idx];
    if (!f) return;
    const n  = countContainsMatches(f);
    const el = document.querySelector(`.contains-summary[data-idx="${idx}"]`);
    if (el) el.innerHTML = containsSummaryText(f, n);
    updateFilterTotals();
  }

  // ── Bind helpers ───────────────────────────────────────────────────────────

  // Binds events inside a filter card body (mode radios, checkboxes, contains input)
  function bindFilterBody(idx) {
    // Mode radio buttons
    document.querySelectorAll(`.filter-mode-radio[data-idx="${idx}"]`).forEach(radio => {
      radio.addEventListener('change', () => {
        state.filters[idx].mode = radio.value;
        document.getElementById(`fpanel-values-${idx}`).style.display   = radio.value === 'values'   ? '' : 'none';
        document.getElementById(`fpanel-contains-${idx}`).style.display = radio.value === 'contains' ? '' : 'none';
        document.getElementById(`fpanel-blank-${idx}`).style.display    = radio.value === 'blank'    ? '' : 'none';
        if (radio.value === 'blank') {
          document.getElementById(`fpanel-blank-${idx}`).innerHTML = filterBlankPanelHtml(state.filters[idx], idx);
        }
        updateFilterTotals();
      });
    });

    // Value checkboxes
    document.querySelectorAll(`.excl-check[data-idx="${idx}"]`).forEach(cb => {
      cb.addEventListener('change', () => {
        const val = cb.dataset.val;
        const f   = state.filters[idx];
        if (cb.checked) { if (!f.excluded.includes(val)) f.excluded.push(val); }
        else            { f.excluded = f.excluded.filter(v => v !== val); }
        cb.closest('.check-label').classList.toggle('is-excluded', cb.checked);
        updateValuesSummary(idx);
      });
    });

    // Contains text input
    const containsEl = document.querySelector(`.contains-input[data-idx="${idx}"]`);
    if (containsEl) {
      containsEl.addEventListener('input', () => {
        state.filters[idx].contains = containsEl.value;
        updateContainsSummary(idx);
      });
    }

    // Case-sensitive checkbox
    const caseEl = document.querySelector(`.case-sens-check[data-idx="${idx}"]`);
    if (caseEl) {
      caseEl.addEventListener('change', () => {
        state.filters[idx].caseSensitive = caseEl.checked;
        updateContainsSummary(idx);
      });
    }
  }

  // Binds the column selector for a filter card (re-renders body on change)
  function bindFilterCard(idx) {
    const sel = document.querySelector(`.filter-col-sel[data-idx="${idx}"]`);
    if (!sel) return;
    sel.addEventListener('change', () => {
      state.filters[idx].column   = sel.value;
      state.filters[idx].excluded = autoExcluded(sel.value);
      state.filters[idx].contains = '';
      document.getElementById(`fbody-${idx}`).innerHTML = filterBodyHtml(state.filters[idx], idx);
      bindFilterBody(idx);
      updateFilterTotals();
    });
    bindFilterBody(idx);
  }

  function bind3() {
    state.filters.forEach((_, i) => bindFilterCard(i));

    document.querySelectorAll('.filter-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        state.filters.splice(Number(btn.dataset.idx), 1);
        document.getElementById('content').innerHTML = html3();
        bind3();
      });
    });

    document.getElementById('add-filter').addEventListener('click', () => {
      state.filters.push(normaliseFilter({}));
      document.getElementById('content').innerHTML = html3();
      bind3();
    });

    document.getElementById('toggle-excl').addEventListener('click', () => {
      const section = document.getElementById('excl-section');
      const preview = document.getElementById('excl-preview');
      const btn     = document.getElementById('toggle-excl');
      const isOpen  = section.style.display !== 'none';
      if (isOpen) {
        section.style.display = 'none';
        btn.textContent = 'Show excluded ▾';
      } else {
        section.style.display = '';
        preview.innerHTML = excludedPreviewHtml();
        btn.textContent = 'Hide excluded ▴';
      }
    });

    document.getElementById('s3-next').addEventListener('click', () => {
      saveFilters();
      const filtered = getFilteredRows();
      const unique   = Transformer.getUniqueValues(filtered, state.columnMap.category);
      state.categoryConfig = autoConfigCategories(unique);
      saveCategoryConfig();
      goTo(4);
    });
  }

  // ── Step 4 — Discipline ────────────────────────────────────────────────────

  // Returns per-rule row counts. A single value can match multiple rules
  // (e.g. "Lead & Boulder" contributes to both Lead and Boulder counts).
  function getRuleMatchCounts(col, rules) {
    if (!col || !rules.length) return rules.map(() => 0);
    const counts = Transformer.getValueCounts(state.rows, col);
    const result = new Array(rules.length).fill(0);
    for (const [val, count] of Object.entries(counts)) {
      for (let i = 0; i < rules.length; i++) {
        if (rules[i].contains && val.toLowerCase().includes(rules[i].contains.toLowerCase())) {
          result[i] += count;
        }
      }
    }
    return result;
  }

  // Returns unique column values not matched by any rule
  function getUnmatched(col, rules) {
    if (!col) return [];
    const counts = Transformer.getValueCounts(state.rows, col);
    return Object.entries(counts)
      .filter(([val]) => !rules.some(r =>
        r.contains && val.toLowerCase().includes(r.contains.toLowerCase())
      ))
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => a.value.localeCompare(b.value));
  }

  function disciplineRulesHtml(rules, col) {
    if (!rules.length) rules = [{ contains: '', label: '' }];
    const counts = col ? getRuleMatchCounts(col, rules) : null;
    return rules.map((r, i) => {
      const n        = counts ? counts[i] : null;
      const hasText  = !!r.contains;
      const badgeCls = n === null || !hasText ? 'rule-badge-empty'
                     : n === 0               ? 'rule-badge-warn'
                     :                         'rule-badge-ok';
      const badgeTxt = n === null || !hasText ? ''
                     : n === 0               ? 'no matches'
                     :                         `${n} row${n !== 1 ? 's' : ''}`;
      return `
        <div class="rule-row">
          <div class="rule-field">
            <label class="field-label">If column contains</label>
            <input type="text" class="rule-contains" data-idx="${i}" placeholder='e.g. LEAD' value="${h(r.contains)}">
          </div>
          <span class="rule-arrow">→</span>
          <div class="rule-field">
            <label class="field-label">Label as</label>
            <input type="text" class="rule-label" data-idx="${i}" placeholder='e.g. Lead' value="${h(r.label)}">
          </div>
          <span class="rule-badge ${badgeCls}" data-ridx="${i}">${badgeTxt}</span>
          <button class="btn btn-ghost btn-sm rule-del" data-idx="${i}" title="Remove">✕</button>
        </div>`;
    }).join('');
  }

  // ── Discipline context renderers ──────────────────────────────────────────

  function renderColValues(col) {
    const el = document.getElementById('disc-col-values');
    if (!el) return;
    if (!col) { el.innerHTML = ''; return; }
    const counts = Transformer.getValueCounts(state.rows, col);
    const entries = Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    el.innerHTML = `
      <div class="disc-col-values-wrap">
        <span class="field-label" style="margin-bottom:.4rem;display:block">Unique values in this column</span>
        <div class="disc-chips">
          ${entries.map(([v, n]) => `<span class="disc-chip">${h(v || '(blank)')} <span class="disc-chip-count">${n}</span></span>`).join('')}
        </div>
      </div>`;
  }

  function renderUnmatchedWarning(col, rules) {
    const el = document.getElementById('disc-unmatched');
    if (!el) return;
    if (!col || !rules.length) { el.innerHTML = ''; return; }
    const unmatched     = getUnmatched(col, rules);
    const unmatchedRows = unmatched.reduce((s, u) => s + u.count, 0);
    if (!unmatched.length) {
      el.innerHTML = `<div class="alert alert-success" style="margin-top:.75rem">✓ All column values are covered by your rules.</div>`;
      return;
    }
    const listId = 'disc-unmatched-list';
    el.innerHTML = `
      <div class="alert alert-warning" style="margin-top:.75rem;display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:.5rem">
        <span>⚠ <strong>${unmatchedRows} row${unmatchedRows !== 1 ? 's' : ''}</strong> (${unmatched.length} value${unmatched.length !== 1 ? 's' : ''}) won't match any rule and will be filed as <em>Unknown</em>.</span>
        <button class="btn-toggle-excl" data-target="${listId}">Show values ▾</button>
      </div>
      <div id="${listId}" style="display:none;margin-top:.4rem;padding:.6rem .75rem;background:#fffbeb;border:1px solid #fcd34d;border-radius:.4rem;font-size:.82rem">
        ${unmatched.map(u => `<div style="display:flex;justify-content:space-between;gap:1rem;padding:.2rem 0;border-bottom:1px solid #fde68a">
          <span>${h(u.value || '(blank)')}</span><span class="text-muted">${u.count} row${u.count !== 1 ? 's' : ''}</span>
        </div>`).join('')}
      </div>`;
    el.querySelector('.btn-toggle-excl').addEventListener('click', function () {
      const target = document.getElementById(this.dataset.target);
      const open   = target.style.display !== 'none';
      target.style.display = open ? 'none' : '';
      this.textContent     = open ? 'Show values ▾' : 'Hide values ▴';
    });
  }

  function renderMappingTable(col, rules) {
    const el = document.getElementById('disc-mapping-table');
    if (!el) return;
    if (!col) { el.innerHTML = '<p class="text-muted" style="font-size:.85rem">Select a column first.</p>'; return; }
    const counts = Transformer.getValueCounts(state.rows, col);
    const entries = Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const rows = entries.map(([val, count]) => {
      const matchedRules = rules.filter(r => r.contains && val.toLowerCase().includes(r.contains.toLowerCase()));
      const labelCell = matchedRules.length
        ? matchedRules.map(r => `<span class="disc-map-ok">${h(r.label || '(no label)')}</span>`).join(' + ')
        : `<span class="disc-map-warn">unmatched ⚠</span>`;
      return `<tr>
        <td style="font-family:monospace;font-size:.82rem">${h(val || '(blank)')}</td>
        <td>${labelCell}</td>
        <td class="text-muted" style="font-size:.82rem;text-align:right">${count}</td>
      </tr>`;
    }).join('');
    el.innerHTML = `
      <table class="map-table" style="margin-top:.5rem">
        <thead><tr><th>Column value</th><th>Mapped label</th><th style="text-align:right">Rows</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  function updateDisciplineContext() {
    const colEl  = document.getElementById('disc-col');
    if (!colEl) return;
    const col   = colEl.value;
    const rules = readRules();
    const wrap  = document.getElementById('rules-wrap');
    if (wrap) wrap.innerHTML = disciplineRulesHtml(rules, col);
    bindRuleEvents();
    renderColValues(col);
    renderUnmatchedWarning(col, rules);
    const mappingSection = document.getElementById('disc-mapping-section');
    if (mappingSection && mappingSection.style.display !== 'none') {
      renderMappingTable(col, rules);
    }
  }

  function html4() {
    const colOpts  = [`<option value="">— select column —</option>`,
      ...state.headers.map(hdr =>
        `<option value="${h(hdr)}" ${hdr === state.disciplineColumn ? 'selected' : ''}>${h(hdr)}</option>`
      ),
    ].join('');
    const isSingle = !state.multiDiscipline;
    return `
      <div class="card">
        <h2>Discipline</h2>
        <p class="subtitle">Does this event have a single discipline (e.g. Lead only) or multiple (Lead + Boulder)?</p>
        <div class="radio-group">
          <label class="radio-opt ${isSingle ? 'selected' : ''}">
            <input type="radio" name="disc" value="single" ${isSingle ? 'checked' : ''}> Single discipline
          </label>
          <label class="radio-opt ${!isSingle ? 'selected' : ''}">
            <input type="radio" name="disc" value="multi"  ${!isSingle ? 'checked' : ''}> Multiple disciplines
          </label>
        </div>
        <div id="single-pane" ${!isSingle ? 'style="display:none"' : ''}>
          <label class="field-label req">Discipline name</label>
          <div style="max-width:220px;margin-top:.4rem">
            <input type="text" id="disc-fixed" placeholder="e.g. Lead" value="${h(state.disciplineFixed)}">
          </div>
        </div>
        <div id="multi-pane" ${isSingle ? 'style="display:none"' : ''}>
          <div style="margin-bottom:.75rem">
            <label class="field-label req">Column containing discipline info</label>
            <div style="max-width:300px;margin-top:.4rem"><select id="disc-col">${colOpts}</select></div>
            <p class="text-muted" style="margin-top:.35rem;font-size:.82rem">All matching rules apply — a value like "Lead &amp; Boulder" can match multiple rules and the athlete will appear in each discipline's file.</p>
          </div>
          <div id="disc-col-values" style="margin-bottom:.9rem"></div>
          <label class="field-label">Match rules</label>
          <div id="rules-wrap" style="margin-top:.6rem">${disciplineRulesHtml(state.disciplineRules, state.disciplineColumn)}</div>
          <button class="btn btn-ghost btn-sm" id="add-rule" style="margin-top:.5rem">+ Add rule</button>
          <div id="disc-unmatched"></div>
          <div style="margin-top:1rem">
            <button class="btn btn-ghost btn-sm" id="show-mapping-btn">Show value mapping ▾</button>
            <div id="disc-mapping-section" style="display:none;margin-top:.6rem">
              <div id="disc-mapping-table"></div>
            </div>
          </div>
        </div>
        <div class="btn-row">
          <button class="btn btn-ghost" onclick="App.goTo(3)">← Back</button>
          <button class="btn btn-primary" id="s4-next">Continue →</button>
        </div>
      </div>`;
  }

  function readRules() {
    return [...document.querySelectorAll('.rule-row')].map(row => ({
      contains: row.querySelector('.rule-contains').value.trim(),
      label:    row.querySelector('.rule-label').value.trim(),
    })).filter(r => r.contains || r.label);
  }

  function bindRuleEvents() {
    document.querySelectorAll('.rule-del').forEach(btn => {
      btn.addEventListener('click', () => {
        state.disciplineRules = readRules().filter((_, i) => i !== Number(btn.dataset.idx));
        updateDisciplineContext();
      });
    });
    document.querySelectorAll('.rule-contains, .rule-label').forEach(inp => {
      inp.addEventListener('input', () => updateDisciplineContext());
    });
  }

  function bind4() {
    document.querySelectorAll('input[name="disc"]').forEach(r => {
      r.addEventListener('change', () => {
        state.multiDiscipline = r.value === 'multi';
        document.getElementById('single-pane').style.display = state.multiDiscipline ? 'none' : '';
        document.getElementById('multi-pane').style.display  = state.multiDiscipline ? ''    : 'none';
        document.querySelectorAll('.radio-opt').forEach(el => el.classList.remove('selected'));
        r.closest('.radio-opt').classList.add('selected');
        if (state.multiDiscipline) updateDisciplineContext();
      });
    });

    const discColSel = document.getElementById('disc-col');
    if (discColSel) {
      discColSel.addEventListener('change', () => updateDisciplineContext());
    }

    document.getElementById('add-rule').addEventListener('click', () => {
      state.disciplineRules = readRules();
      state.disciplineRules.push({ contains: '', label: '' });
      updateDisciplineContext();
    });

    const mappingBtn = document.getElementById('show-mapping-btn');
    if (mappingBtn) {
      mappingBtn.addEventListener('click', () => {
        const section = document.getElementById('disc-mapping-section');
        const open    = section.style.display !== 'none';
        section.style.display  = open ? 'none' : '';
        mappingBtn.textContent = open ? 'Show value mapping ▾' : 'Hide value mapping ▴';
        if (!open) {
          const col   = document.getElementById('disc-col').value;
          const rules = readRules();
          renderMappingTable(col, rules);
        }
      });
    }

    bindRuleEvents();

    if (state.multiDiscipline && state.disciplineColumn) {
      updateDisciplineContext();
    }

    document.getElementById('s4-next').addEventListener('click', () => {
      if (state.multiDiscipline) {
        state.disciplineColumn = document.getElementById('disc-col').value;
        state.disciplineRules  = readRules().filter(r => r.contains && r.label);
        if (!state.disciplineColumn) { alert('Please select the discipline column.'); return; }
        if (!state.disciplineRules.length) { alert('Please add at least one match rule.'); return; }
      } else {
        state.disciplineFixed = document.getElementById('disc-fixed').value.trim();
        if (!state.disciplineFixed) { alert('Please enter the discipline name.'); return; }
      }
      saveColumnSettings();
      goTo(5);
    });
  }

  // ── Category diagnostic preview ───────────────────────────────────────────
  let catPreviewRows        = [];
  let catPreviewVisibleCols = null; // null until first open; persists across categories

  function defaultCatPreviewCols() {
    const cols = new Set(Object.values(state.columnMap).filter(Boolean));
    state.filters.forEach(f => { if (f.column) cols.add(f.column); });
    return cols;
  }

  function renderCatPreviewTable() {
    const el = document.getElementById('cat-modal-body');
    if (!el) return;
    const visible = state.headers.filter(c => catPreviewVisibleCols.has(c));
    if (!visible.length) {
      el.innerHTML = '<p class="text-muted" style="padding:.5rem 0">Select at least one column above.</p>';
      return;
    }
    if (!catPreviewRows.length) {
      el.innerHTML = '<p class="text-muted" style="padding:.5rem 0">No rows in this category.</p>';
      return;
    }
    const thead = visible.map(c => `<th style="white-space:nowrap">${h(c)}</th>`).join('');
    const tbody = catPreviewRows.map(row =>
      `<tr>${visible.map(c => `<td style="white-space:nowrap">${h(String(row[c] ?? ''))}</td>`).join('')}</tr>`
    ).join('');
    el.innerHTML = `<div style="overflow-x:auto"><table class="map-table"><thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody></table></div>`;
  }

  function renderCatPreviewChips() {
    const el = document.getElementById('cat-col-chips');
    if (!el) return;
    el.innerHTML = state.headers.map(c => {
      const on = catPreviewVisibleCols.has(c);
      return `<button class="cat-chip${on ? ' active' : ''}" data-col="${h(c)}">${h(c)}</button>`;
    }).join('');
    el.querySelectorAll('.cat-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const col = chip.dataset.col;
        if (catPreviewVisibleCols.has(col)) { catPreviewVisibleCols.delete(col); chip.classList.remove('active'); }
        else                                { catPreviewVisibleCols.add(col);    chip.classList.add('active');    }
        renderCatPreviewTable();
      });
    });
  }

  function closeCatPreview() {
    document.getElementById('cat-preview-modal').style.display = 'none';
    const box = document.getElementById('cat-modal-box');
    const btn = document.getElementById('cat-modal-expand');
    if (box) {
      box.classList.remove('modal-fullscreen');
      box.style.maxWidth = '';
      box.style.width    = '';
      btn.textContent    = '⤢';
      btn.title          = 'Expand to full window';
    }
  }

  function ensureCatPreviewModal() {
    if (document.getElementById('cat-preview-modal')) return;
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <div id="cat-preview-modal" class="modal-backdrop" style="display:none">
        <div class="modal-box" style="max-width:900px" id="cat-modal-box">
          <div class="modal-head">
            <div style="display:flex;align-items:center;gap:.6rem;flex:1;min-width:0">
              <span id="cat-modal-title" class="modal-title"></span>
              <span id="cat-modal-rowcount" class="file-badge"></span>
            </div>
            <div style="display:flex;gap:.35rem">
              <button id="cat-modal-expand" class="btn btn-ghost btn-sm" title="Expand to full window">⤢</button>
              <button id="cat-modal-close" class="btn btn-ghost btn-sm">✕ Close</button>
            </div>
          </div>
          <div style="padding:.65rem 1rem;border-bottom:1px solid #e2e8f0;background:#f8fafc">
            <div style="font-size:.72rem;font-weight:600;color:#475569;margin-bottom:.35rem;text-transform:uppercase;letter-spacing:.04em">Visible columns</div>
            <div id="cat-col-chips" class="cat-chips"></div>
          </div>
          <div class="modal-body" id="cat-modal-body"></div>
        </div>
      </div>`;
    document.body.appendChild(wrap.firstElementChild);
    document.getElementById('cat-modal-close').addEventListener('click', closeCatPreview);
    document.getElementById('cat-modal-expand').addEventListener('click', () => {
      const box = document.getElementById('cat-modal-box');
      const btn = document.getElementById('cat-modal-expand');
      const expanding = !box.classList.contains('modal-fullscreen');
      box.classList.toggle('modal-fullscreen', expanding);
      box.style.maxWidth = expanding ? '100%' : '';
      box.style.width    = expanding ? '100%' : '';
      btn.textContent    = expanding ? '⤡' : '⤢';
      btn.title          = expanding ? 'Restore' : 'Expand to full window';
    });
    document.getElementById('cat-preview-modal').addEventListener('click', e => {
      if (e.target.id === 'cat-preview-modal') closeCatPreview();
    });
  }

  function openCatPreviewModal(title, rows) {
    catPreviewRows = rows;
    ensureCatPreviewModal();
    document.getElementById('cat-modal-title').textContent    = title;
    document.getElementById('cat-modal-rowcount').textContent =
      `${rows.length} row${rows.length !== 1 ? 's' : ''}`;
    renderCatPreviewChips();
    renderCatPreviewTable();
    document.getElementById('cat-preview-modal').style.display = '';
  }

  function openCategoryPreview(catRaw) {
    if (!catPreviewVisibleCols) catPreviewVisibleCols = defaultCatPreviewCols();
    const conf  = state.categoryConfig[catRaw];
    const label = conf ? (conf.label || catRaw || '(blank)') : (catRaw || '(blank)');
    openCatPreviewModal(label, state.rows.filter(row =>
      Transformer.isRowIncluded(row, state) &&
      String(row[state.columnMap.category] ?? '').trim() === catRaw
    ));
  }

  function openDataPreview() {
    if (!catPreviewVisibleCols) catPreviewVisibleCols = defaultCatPreviewCols();
    openCatPreviewModal(state.fileName, state.rows);
  }

  // ── Step 5 — Categories ────────────────────────────────────────────────────
  function typeBtns(rawVal, type) {
    return ['athlete', 'official', 'exclude'].map(t =>
      `<button class="type-btn${type === t ? ` active-${t}` : ''}" data-cat="${h(rawVal)}" data-type="${t}">${
        t === 'athlete' ? 'Athlete' : t === 'official' ? 'Official' : 'Exclude'
      }</button>`
    ).join('');
  }

  function html5() {
    const filteredRows = getFilteredRows();
    const blankCount   = filteredRows.filter(r => !String(r[state.columnMap.category] ?? '').trim()).length;
    const blankAlert   = blankCount
      ? `<div class="alert alert-warning" style="margin-bottom:1rem">
           ⚠️ <strong>${blankCount} row${blankCount !== 1 ? 's' : ''}</strong> have a blank category — set to <em>Exclude</em> by default.
         </div>`
      : '';
    const tableRows = Object.entries(state.categoryConfig).map(([rawVal, conf]) => {
      const rowCount = getFilteredRows().filter(r =>
        String(r[state.columnMap.category] ?? '').trim() === rawVal
      ).length;
      const catDisplay = rawVal === '' ? '<em class="text-muted">(blank)</em>' : h(rawVal);
      return `
        <tr>
          <td style="max-width:220px">
            <div>${catDisplay}</div>
            <div style="margin-top:.2rem;font-size:.75rem;color:#94a3b8">
              ${rowCount} row${rowCount !== 1 ? 's' : ''} · <button class="btn-link cat-preview-btn" style="font-size:.75rem" data-cat="${h(rawVal)}">Preview</button>
            </div>
          </td>
          <td><input type="text" class="cat-label" data-cat="${h(rawVal)}" value="${h(conf.label)}" placeholder="Short label"></td>
          <td><div class="type-group">${typeBtns(rawVal, conf.type)}</div></td>
        </tr>`;
    }).join('');
    return `
      <div class="card">
        <h2>Configure Categories</h2>
        <p class="subtitle">Every unique category in your filtered data. Give each a short label (used in filenames) and classify it.</p>
        ${blankAlert}
        <table class="map-table">
          <thead><tr>
            <th>Category (from Wild Apricot)</th>
            <th>Label <span class="text-muted">(filename)</span></th>
            <th>Type</th>
          </tr></thead>
          <tbody>${tableRows}</tbody>
        </table>
        <div class="btn-row">
          <button class="btn btn-ghost" onclick="App.goTo(4)">← Back</button>
          <button class="btn btn-primary" id="s5-next">Preview →</button>
        </div>
      </div>`;
  }

  function bind5() {
    document.querySelectorAll('.cat-preview-btn').forEach(btn => {
      btn.addEventListener('click', () => openCategoryPreview(btn.dataset.cat));
    });
    document.querySelectorAll('.cat-label').forEach(inp => {
      inp.addEventListener('input', () => { state.categoryConfig[inp.dataset.cat].label = inp.value; });
    });
    document.querySelectorAll('.type-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const { cat, type } = btn.dataset;
        state.categoryConfig[cat].type = type;
        btn.closest('.type-group').querySelectorAll('.type-btn').forEach(b => {
          b.className = `type-btn${b.dataset.type === type ? ` active-${b.dataset.type}` : ''}`;
        });
      });
    });
    document.getElementById('s5-next').addEventListener('click', () => {
      document.querySelectorAll('.cat-label').forEach(inp => {
        if (state.categoryConfig[inp.dataset.cat]) {
          state.categoryConfig[inp.dataset.cat].label = inp.value.trim() || inp.dataset.cat;
        }
      });
      saveCategoryConfig();
      state.outputFiles = Transformer.generateOutputFiles(state);
      goTo(6);
    });
  }

  // ── Step 6 — Export ────────────────────────────────────────────────────────
  function html6() {
    const total        = state.outputFiles.reduce((s, f) => s + f.count, 0);
    const warnings     = state.outputFiles.filter(f => f.isWarning);
    const excludedRows = state.rows.length - getFilteredRows().length;

    const filterNote = excludedRows
      ? `<div class="alert alert-info" style="margin-bottom:1rem">
           <strong>${excludedRows}</strong> row${excludedRows !== 1 ? 's' : ''} excluded by filters
           (${state.rows.length - excludedRows} exported).
         </div>`
      : '';
    const warnAlert = warnings.length
      ? `<div class="alert alert-warning" style="margin-bottom:1rem">
           ⚠️ ${warnings.length} file(s) contain rows with unconfigured categories — included in the ZIP for review.
         </div>`
      : '';
    const items = state.outputFiles.map((f, i) => `
      <div class="file-item ${f.isWarning ? 'warn' : ''}">
        <span>${f.isWarning ? '⚠️' : '📄'}</span>
        <span class="file-name">${h(f.filename)}</span>
        <span class="file-badge">${f.count} row${f.count !== 1 ? 's' : ''}</span>
        <div class="file-actions">
          <button class="btn btn-ghost btn-sm preview-btn" data-idx="${i}">Preview</button>
          <button class="btn btn-ghost btn-sm dl-single-btn" data-idx="${i}" title="Download this file">↓</button>
        </div>
      </div>`).join('');
    return `
      <div class="card">
        <h2>Ready to Export</h2>
        <p class="subtitle">${state.outputFiles.length} files · ${total} rows · from <strong>${h(state.fileName)}</strong></p>
        ${filterNote}
        ${warnAlert}
        <div class="file-list">${items}</div>
        <div class="btn-row">
          <button class="btn btn-ghost" onclick="App.goTo(5)">← Back</button>
          <button class="btn btn-ghost" id="export-separate-btn">↓ Download CSV files</button>
          <button class="btn btn-primary" id="export-btn">⬇ Download ZIP</button>
        </div>
      </div>`;
  }

  // ── Download helpers ──────────────────────────────────────────────────────
  function downloadSingleFile(file) {
    const blob = new Blob([file.content], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = file.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  async function downloadAllSeparate() {
    const btn = document.getElementById('export-separate-btn');
    btn.disabled = true;
    btn.textContent = '↓ Downloading…';
    for (const file of state.outputFiles) {
      downloadSingleFile(file);
      await new Promise(r => setTimeout(r, 150));
    }
    btn.disabled = false;
    btn.textContent = '↓ Download CSV files';
  }

  // ── File preview modal ────────────────────────────────────────────────────
  let previewMode        = 'table';
  let currentPreviewFile = null;
  const PREVIEW_HEADERS  = ['First Name', 'Last Name', 'Gender', 'DOB', 'State'];

  function parsePreviewRows(content) {
    return Papa.parse(content, { header: false, skipEmptyLines: true }).data;
  }

  function previewTableHtml(rows) {
    const thead = PREVIEW_HEADERS.map(c => `<th>${c}</th>`).join('');
    const tbody = rows.map(r =>
      `<tr>${r.map(c => `<td>${h(c)}</td>`).join('')}</tr>`
    ).join('');
    return `<table class="map-table"><thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody></table>`;
  }

  function previewCsvHtml(content) {
    return `
      <div style="display:flex;justify-content:flex-end;margin-bottom:.5rem">
        <button class="btn btn-ghost btn-sm" id="copy-csv-btn">Copy to clipboard</button>
      </div>
      <pre class="csv-preview">${h(content)}</pre>`;
  }

  function renderModalContent(file) {
    const bodyEl = document.getElementById('modal-body');
    if (previewMode === 'table') {
      bodyEl.innerHTML = previewTableHtml(parsePreviewRows(file.content));
    } else {
      bodyEl.innerHTML = previewCsvHtml(file.content);
      document.getElementById('copy-csv-btn').addEventListener('click', function () {
        navigator.clipboard.writeText(file.content).then(() => {
          this.textContent = '✓ Copied!';
          setTimeout(() => { this.textContent = 'Copy to clipboard'; }, 2000);
        });
      });
    }
  }

  function closePreview() {
    document.getElementById('preview-modal').style.display = 'none';
    currentPreviewFile = null;
  }

  function openPreviewFile(file) {
    currentPreviewFile = file;
    ensurePreviewModal();
    document.getElementById('modal-title').textContent    = file.filename;
    document.getElementById('modal-rowcount').textContent = `${file.count} row${file.count !== 1 ? 's' : ''}`;
    document.querySelectorAll('input[name="preview-mode"]').forEach(r => { r.checked = r.value === previewMode; });
    renderModalContent(file);
    document.getElementById('preview-modal').style.display = '';
  }

  function openPreview(idx) {
    openPreviewFile(state.outputFiles[idx]);
  }

  function ensurePreviewModal() {
    if (document.getElementById('preview-modal')) return;
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <div id="preview-modal" class="modal-backdrop" style="display:none">
        <div class="modal-box">
          <div class="modal-head">
            <div style="display:flex;align-items:center;gap:.6rem;flex:1;min-width:0">
              <span id="modal-title" class="modal-title"></span>
              <span id="modal-rowcount" class="file-badge"></span>
            </div>
            <div style="display:flex;align-items:center;gap:.75rem;flex-shrink:0">
              <div style="display:flex;gap:.4rem">
                <label class="radio-inline"><input type="radio" name="preview-mode" value="table" checked> Table</label>
                <label class="radio-inline"><input type="radio" name="preview-mode" value="csv"> CSV</label>
              </div>
              <button id="modal-close" class="btn btn-ghost btn-sm">✕ Close</button>
            </div>
          </div>
          <div class="modal-body" id="modal-body"></div>
        </div>
      </div>`;
    document.body.appendChild(wrap.firstElementChild);

    document.getElementById('modal-close').addEventListener('click', closePreview);
    document.getElementById('preview-modal').addEventListener('click', e => {
      if (e.target.id === 'preview-modal') closePreview();
    });
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      const ep = document.getElementById('preview-modal');
      const cp = document.getElementById('cat-preview-modal');
      if (ep && ep.style.display !== 'none') closePreview();
      if (cp && cp.style.display !== 'none') closeCatPreview();
    });
    document.querySelectorAll('input[name="preview-mode"]').forEach(r => {
      r.addEventListener('change', () => {
        previewMode = r.value;
        if (currentPreviewFile) renderModalContent(currentPreviewFile);
      });
    });
  }

  function bind6() {
    ensurePreviewModal();
    document.querySelectorAll('.preview-btn').forEach(btn => {
      btn.addEventListener('click', () => openPreview(Number(btn.dataset.idx)));
    });
    document.querySelectorAll('.dl-single-btn').forEach(btn => {
      btn.addEventListener('click', () => downloadSingleFile(state.outputFiles[Number(btn.dataset.idx)]));
    });
    document.getElementById('export-separate-btn').addEventListener('click', downloadAllSeparate);
    document.getElementById('export-btn').addEventListener('click', async () => {
      const btn = document.getElementById('export-btn');
      btn.disabled = true;
      btn.innerHTML = '<span class="spin"></span> Building ZIP…';
      try {
        const stamp = new Date().toISOString().slice(0, 10);
        await Exporter.downloadZip(state.outputFiles, `vertical_life_${stamp}.zip`);
        btn.innerHTML = '✓ Downloaded!';
        btn.style.background = '#16a34a';
      } catch (err) {
        btn.disabled = false;
        btn.innerHTML = '⬇ Download ZIP';
        alert(`Export failed: ${err.message}`);
      }
    });
  }

  // ── Boot ───────────────────────────────────────────────────────────────────
  window.App = { goTo };
  goTo(0);

})();
