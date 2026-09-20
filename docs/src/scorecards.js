/* global App, Bibs */
const Scorecards = (() => {
  const STORAGE_KEY = 'wa_vl_scorecard_config_v1';
  const SCALE = 0.5; // on-screen preview scale factor (reset to none for print)

  function h(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

  // Formats the native <input type="date"> value (YYYY-MM-DD) for display on
  // the card, e.g. "15 March 2026". Avoids new Date() to sidestep timezone
  // shift on date-only strings. Passes through unchanged if unparseable.
  function formatEventDate(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    if (!m) return iso || '';
    return `${parseInt(m[3], 10)} ${MONTHS[parseInt(m[2], 10) - 1]} ${m[1]}`;
  }

  function sliderRowHtml(label, id, value, min, max, step, unit) {
    return `
      <div style="display:flex;align-items:center;gap:.65rem;margin-bottom:.65rem">
        <label for="${id}" style="font-size:.75rem;color:#475569;min-width:72px;flex-shrink:0">${label}</label>
        <input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${value}"
          style="flex:1;min-width:0;accent-color:#2563eb;cursor:pointer;padding:0;border:none">
        <span id="${id}-val" style="font-size:.75rem;color:#64748b;min-width:2rem;text-align:right">${value}${unit}</span>
      </div>`;
  }

  // ── State ─────────────────────────────────────────────────────────────────
  let athletes         = [];
  let fileName         = '';
  let hasData          = false;   // false = blank-cards-only mode, no CSV uploaded
  let blankCount       = 20;
  let view             = 'upload'; // 'upload' | 'config' | 'design' | 'select' | 'preview'
  let selectedBibs     = new Set();
  let selectFilterCat  = new Set();
  let selectFilterDisc = '';
  let selectFilterName = '';

  function defaultConfig() {
    return {
      eventName:  '',
      eventDate:  '',
      eventVenue: '',
      instructionText: '',  // optional small note under Category, for competitors/judges
      paper:      'a5',   // 'a5' | 'a4'
      zones:      true,
      judge:      false,
      merge:      true,
      labels:     false,  // merge mode only: show field labels (Name/Bib #/Category)
      lines:      false,  // merge mode only: show writing lines under fields
      boulders:   20,
      columns:    0,       // 0 = auto, else 1-3
      rows:       0,       // 0 = auto, else 5-30
      marginTop:    0,     // extra print margin, mm, on top of the design's built-in padding
      marginRight:  0,
      marginBottom: 0,
      marginLeft:   0,
      categoryOffset:    0,  // vertical nudge, mm, from default position (can be negative)
      instructionOffset: 0,
    };
  }

  function loadConfig() {
    const defaults = defaultConfig();
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (saved && typeof saved === 'object') {
        return { ...defaults, ...saved };
      }
    } catch {}
    return defaults;
  }

  const config = loadConfig();

  function saveConfig() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(config)); } catch {}
  }

  // ── Scorecard geometry & markup ──────────────────────────────────────────
  // Ported from scorecards_handover/scorecard-reference.html (the approved
  // design canvas export). Keep the constants/math identical to the
  // reference — see HANDOFF.md for the full spec this implements.
  const PAPER = {
    a5: { W: 794,  H: 559, S: 1,        page: 'A5' },
    a4: { W: 1123, H: 794, S: 1123 / 794, page: 'A4' },
  };

  function cardHtml(cfg, athlete) {
    const P = PAPER[cfg.paper] || PAPER.a5;
    const W = P.W, H = P.H, S = P.S;
    const px = v => +(v * S).toFixed(1) + 'px';
    const mmToPx = mm => mm * 96 / 25.4; // physical mm -> css px at 96dpi, independent of paper-scale S
    const BLACK = '#000000';

    const eventText = cfg.eventName && cfg.eventName.trim() ? cfg.eventName : '[Event name]';
    const venueText = cfg.eventVenue || '[Venue]';
    const dateText  = formatEventDate(cfg.eventDate) || '[Date]';
    const nameText = athlete ? `${athlete.first} ${athlete.last}`.trim() : '[Name]';
    const bibText  = athlete && athlete.bib       ? athlete.bib       : '[Bib]';
    const catText  = athlete && athlete.ageGender ? athlete.ageGender : '[Category]';
    const instructionText = (cfg.instructionText || '').trim();

    // ---- geometry ---------------------------------------------------------
    const n = Math.max(6, Math.min(30, cfg.boulders || 20));
    let ncol, per;
    if (cfg.rows > 0) {
      per = cfg.rows;
      ncol = Math.min(3, cfg.columns > 0 ? cfg.columns : Math.ceil(n / per));
      per = Math.max(per, Math.ceil(n / ncol));
    } else {
      ncol = Math.min(3, cfg.columns > 0 ? cfg.columns : Math.ceil(n / 10));
      per = Math.ceil(n / ncol);
    }
    ncol = Math.ceil(n / per); // drop columns that would be empty
    const AREA = H - 300 * S + ((cfg.merge && !cfg.labels) ? 28 * S : 0) // no label row means more room
      - mmToPx(cfg.marginTop) - mmToPx(cfg.marginBottom)
      - (instructionText ? 16 * S : 0)
      - mmToPx(cfg.categoryOffset)
      - (instructionText ? mmToPx(cfg.instructionOffset) : 0);
    const rowH = Math.floor(Math.min(AREA / per, 52 * S));
    const IW = W - 48 * S - mmToPx(cfg.marginLeft) - mmToPx(cfg.marginRight), gap = 20 * S;
    const colW = (IW - gap * (ncol - 1)) / ncol;
    const numFs = Math.round(Math.min(rowH * 0.55, 22 * S));

    // ---- small helpers ------------------------------------------------------
    function svg(kind) {
      const inner = {
        a: '<line x1="10" y1="3" x2="10" y2="17"/>',
        z: '<line x1="10" y1="3" x2="10" y2="17"/><line x1="4" y1="17" x2="16" y2="17"/>',
        t: '<circle cx="10" cy="10" r="9"/><line x1="10" y1="5" x2="10" y2="15"/>',
      }[kind];
      return `<svg width="${px(20)}" height="${px(20)}" viewBox="0 0 20 20" fill="none" stroke="#000" stroke-width="1.8" stroke-linecap="round" aria-hidden="true" style="flex:none">${inner}</svg>`;
    }
    const label = `font-size:${px(12)};line-height:1;font-weight:700;letter-spacing:.08em;text-transform:uppercase;`;
    function field(text, ph, size, boxH, boxStyle) {
      const showLabel = cfg.merge ? cfg.labels : true;
      const showLine  = cfg.merge ? cfg.lines  : true;
      const wrap = `display:flex;flex-direction:column;gap:${px(2)};min-width:0;${boxStyle}`;
      const lineStyle = showLine ? `border-bottom:${px(2)} solid ${BLACK};` : '';
      return `<div style="${wrap}">` +
        (showLabel ? `<span style="${label}">${h(text)}</span>` : '') +
        `<div style="height:${px(boxH)};${lineStyle}display:flex;align-items:flex-end;padding-bottom:${px(3)};` +
        `font-family:'Barlow Condensed',sans-serif;font-size:${px(size)};line-height:1;font-weight:700;white-space:nowrap;overflow:hidden">` +
        (cfg.merge ? h(ph) : '') + '</div></div>';
    }
    function item(kind, text) {
      return `<div style="display:flex;align-items:center;gap:${px(4)}">${svg(kind)}<span>${text}</span></div>`;
    }
    function cell(width, extra) { return `<div style="flex:none;width:${px(width)};${extra}"></div>`; }

    // ---- header -------------------------------------------------------------
    const exampleSeq = cfg.zones ? ['a', 'a', 'z', 't'] : ['a', 'a', 'a', 't'];
    const combineBibName = cfg.merge && !cfg.labels && !cfg.lines;
    const bibNameRow = combineBibName
      ? `<div style="display:flex;align-items:flex-end;gap:${px(20)}">` +
          field('', `#${bibText} - ${nameText}`, 34, 40, 'flex:1 1 0;') +
        '</div>'
      : `<div style="display:flex;align-items:flex-end;gap:${px(20)}">` +
          field('Bib #', bibText, 34, 40, `flex:none;width:${px(120)};`) +
          field('Name', nameText, 34, 40, 'flex:1 1 0;') +
        '</div>';
    const header =
      `<div style="display:flex;flex-direction:column;gap:${px(6)}">` +
        `<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:${px(28)}">` +
          `<div style="flex:1 1 0;min-width:0;display:flex;flex-direction:column;gap:${px(6)}">` +
            bibNameRow +
            field('Category', catText, 22, 32, `flex:none;width:${px(300)};margin-top:${mmToPx(cfg.categoryOffset).toFixed(1)}px`) +
            (instructionText ? `<div style="font-size:${px(10)};line-height:1.3;font-weight:500;margin-top:${(2 * S + mmToPx(cfg.instructionOffset)).toFixed(1)}px">${h(instructionText)}</div>` : '') +
          '</div>' +
          `<div style="flex:none;width:${px(250)};display:flex;flex-direction:column;align-items:flex-end;gap:${px(4)};text-align:right">` +
            `<h1 style="margin:0;font-family:'Barlow Condensed',sans-serif;font-size:${px(26)};line-height:1.05;font-weight:800;letter-spacing:.02em;text-transform:uppercase">${h(eventText)}</h1>` +
            `<div style="font-size:${px(14)};line-height:1.25;font-weight:500">${h(venueText)}</div>` +
            `<div style="font-size:${px(14)};line-height:1.25;font-weight:500">${h(dateText)}</div>` +
          '</div>' +
        '</div>' +
        `<div style="display:flex;align-items:center;gap:${px(14)};font-size:${px(12)};line-height:1;font-weight:700">` +
          item('a', 'Attempt') + (cfg.zones ? item('z', 'Zone') : '') + item('t', 'Top') +
          `<div style="flex:none;width:1px;height:${px(20)};background:#000"></div>` +
          '<span style="letter-spacing:.08em;text-transform:uppercase">Example</span>' +
          `<div style="display:flex;align-items:center;gap:${px(5)};height:${px(26)};border:1px solid #000;padding:0 ${px(8)}">${exampleSeq.map(svg).join('')}</div>` +
          `<span style="font-weight:500">${cfg.zones ? 'Zone 3 · Top 4' : 'Top 4'}</span>` +
          `<span style="font-weight:500;font-style:italic">(write 0 if not ${cfg.zones ? 'reached' : 'topped'})</span>` +
        '</div>' +
      '</div>';

    // ---- table ----------------------------------------------------------
    const headCell = (w, borderLeft, text) =>
      `<div style="flex:none;width:${px(w)};display:flex;align-items:center;justify-content:center;border-left:${borderLeft} solid #000;` +
      `font-size:${px(12)};line-height:1;font-weight:700;letter-spacing:.04em;text-transform:uppercase;white-space:nowrap">${text}</div>`;
    const tableHead =
      `<div style="display:flex;align-items:stretch;height:${px(26)}">` +
        `<div style="flex:none;width:${px(30)};display:flex;align-items:center;justify-content:center;font-size:${px(12)};line-height:1;font-weight:700">#</div>` +
        `<div style="flex:1 1 0;min-width:0;display:flex;align-items:center;padding-left:${px(8)};border-left:1px solid #000;${label}white-space:nowrap">Attempts</div>` +
        (cfg.zones ? headCell(36, '1px', 'Zone') : '') +
        headCell(36, '1px', 'Top') +
        (cfg.judge ? headCell(44, '1px', 'Judge') : '') +
      '</div>';

    function row(num) {
      return `<div style="display:flex;align-items:stretch;height:${rowH}px;border-top:1px solid #000">` +
        `<div style="flex:none;width:${px(30)};display:flex;align-items:center;justify-content:center;font-family:'Barlow Condensed',sans-serif;font-weight:800;font-size:${numFs}px;line-height:1">${num}</div>` +
        `<div style="flex:1 1 0;min-width:0;border-left:1px solid #000"></div>` +
        (cfg.zones ? cell(36, 'border-left:1px solid #000;') : '') +
        cell(36, 'border-left:1px solid #000;') +
        (cfg.judge ? cell(44, 'border-left:1px solid #000;') : '') +
      '</div>';
    }

    let columns = '';
    for (let c = 0; c < ncol; c++) {
      const start = c * per, cnt = Math.min(per, n - start);
      let rows = '';
      for (let j = 0; j < cnt; j++) rows += row(start + j + 1);
      columns += `<div style="flex:none;width:${colW}px;border:${px(1.5)} solid #000">${tableHead}${rows}</div>`;
    }

    // ---- footer ---------------------------------------------------------
    const total = (text, borderW) =>
      `<div style="flex:none;display:flex;flex-direction:column;gap:${px(3)};align-items:center"><span style="${label}">${text}</span>` +
      `<div style="width:${px(76)};height:${px(48)};border:${px(borderW)} solid #000"></div></div>`;
    const official = text =>
      `<div style="flex:none;display:flex;flex-direction:column;gap:${px(3)}"><span style="${label}">${text}</span>` +
      `<div style="width:${px(70)};height:${px(48)};border:${px(1.5)} solid #000"></div></div>`;
    const footer =
      `<div style="margin-top:auto;display:flex;align-items:flex-end;gap:${px(18)}">` +
        `<div style="flex:none;font-family:'Barlow Condensed',sans-serif;font-size:${px(22)};line-height:1;font-weight:800;letter-spacing:.04em;text-transform:uppercase;padding-bottom:${px(12)}">Totals</div>` +
        total('Tops', 1.5) + (cfg.zones ? total('Zones', 1.5) : '') +
        `<div style="flex:1 1 0;display:flex;flex-direction:column;gap:${px(3)}"><span style="${label}">Athlete signature</span>` +
          `<div style="height:${px(48)};border-bottom:${px(1.5)} solid #000"></div></div>` +
        official('Checked') + official('Entered') +
      '</div>';

    const inner = header + `<div style="display:flex;gap:${px(20)};align-items:flex-start">${columns}</div>` + footer;

    const padTop    = (24 * S + mmToPx(cfg.marginTop)).toFixed(1);
    const padRight  = (24 * S + mmToPx(cfg.marginRight)).toFixed(1);
    const padBottom = (24 * S + mmToPx(cfg.marginBottom)).toFixed(1);
    const padLeft   = (24 * S + mmToPx(cfg.marginLeft)).toFixed(1);

    return `
      <div class="scorecard-scale-wrap" style="width:${(W * SCALE).toFixed(1)}px;height:${(H * SCALE).toFixed(1)}px">
        <div class="scorecard-card" style="width:${W}px;height:${H}px;padding:${padTop}px ${padRight}px ${padBottom}px ${padLeft}px;display:flex;flex-direction:column;gap:${px(8)};transform:scale(${SCALE})">
          ${inner}
        </div>
      </div>`;
  }

  // ── View HTML ─────────────────────────────────────────────────────────────
  function htmlUpload() {
    return `
      <div class="card">
        <h2>Scorecard Generator</h2>
        <p class="subtitle">Upload a Vertical Life athlete export to generate mail-merged, self-scoring boulder scorecards.</p>
        <div class="dropzone" id="sc-dz">
          <div class="dz-icon">📝</div>
          <p><strong>Drop Vertical Life athlete export here</strong></p>
          <p class="text-sm" style="margin-top:.4rem">or <span class="link" id="sc-browse">browse for file</span></p>
          <p class="text-muted" style="margin-top:.75rem">CSV · semicolon-delimited</p>
          <input type="file" id="sc-file" accept=".csv,.txt">
        </div>
        <div id="sc-parse-status"></div>
        <p style="text-align:center;margin-top:1.25rem">
          <span class="link" id="sc-skip-upload">Skip — print blank cards only →</span>
        </p>
      </div>`;
  }

  function bindUpload() {
    const dz    = document.getElementById('sc-dz');
    const input = document.getElementById('sc-file');
    document.getElementById('sc-browse').addEventListener('click', () => input.click());
    input.addEventListener('change', () => { if (input.files[0]) loadFile(input.files[0]); });
    dz.addEventListener('dragover',  e => { e.preventDefault(); dz.classList.add('over'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('over'));
    dz.addEventListener('drop', e => {
      e.preventDefault(); dz.classList.remove('over');
      if (e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]);
    });
    document.getElementById('sc-skip-upload').addEventListener('click', () => {
      hasData  = false;
      athletes = [];
      fileName = '';
      config.merge = false;
      saveConfig();
      view = 'config';
      render();
    });
  }

  function loadFile(file) {
    const status = document.getElementById('sc-parse-status');
    if (status) {
      status.innerHTML = `<div class="alert alert-info"><span class="spin"></span> Parsing <strong>${h(file.name)}</strong>…</div>`;
    }
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const parsed = Bibs.parseBibCsv(e.target.result);
        if (!parsed.length) {
          if (status) status.innerHTML = `<div class="alert alert-warning">No athlete rows found. Make sure this is a Vertical Life export with semicolon delimiters and a <em>bib</em> column.</div>`;
          return;
        }
        athletes         = parsed;
        fileName         = file.name;
        hasData          = true;
        selectedBibs     = new Set();
        selectFilterCat  = new Set();
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
  function htmlConfig() {
    const paperOpts = [
      { v: 'a5', label: 'A5' },
      { v: 'a4', label: 'A4' },
    ].map(o => `
      <label class="radio-opt ${config.paper === o.v ? 'selected' : ''}">
        <input type="radio" name="sc-paper" value="${o.v}" ${config.paper === o.v ? 'checked' : ''}> ${o.label}
      </label>`).join('');

    const mergeOpts = [
      { v: '1', label: 'Fill in athlete details' },
      { v: '0', label: 'Leave blank for hand entry' },
    ].map(o => `
      <label class="radio-opt ${(config.merge ? '1' : '0') === o.v ? 'selected' : ''}">
        <input type="radio" name="sc-merge" value="${o.v}" ${(config.merge ? '1' : '0') === o.v ? 'checked' : ''}> ${o.label}
      </label>`).join('');

    return `
      <div class="card" id="sc-config-section" style="margin-bottom:1.5rem">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:.75rem">
          <div>
            <h2>Configure Scorecards</h2>
            <p class="subtitle" style="margin:0">${hasData ? `${h(fileName)} — ${athletes.length} athletes loaded` : 'Generating blank cards — no athlete file loaded'}</p>
          </div>
          <div style="display:flex;gap:.5rem;flex-wrap:wrap">
            <button class="btn btn-ghost" id="sc-back-upload">← Different file</button>
            <button class="btn btn-primary" id="sc-goto-design">Next: Design →</button>
          </div>
        </div>
      </div>

      <div class="card">
          <div style="max-width:520px;margin-bottom:1.5rem">
            <label class="field-label req">Event name</label>
            <input type="text" id="sc-event-name" value="${h(config.eventName)}" placeholder="e.g. Australian Youth Championships 2025">
          </div>
          <div style="max-width:520px;margin-bottom:1.5rem">
            <label class="field-label">Instruction text</label>
            <input type="text" id="sc-instruction-text" value="${h(config.instructionText)}" placeholder="e.g. No resoles · chalk only on marked volumes">
            <p class="text-muted" style="font-size:.78rem;margin-top:.35rem">Optional — appears in small text under the category on every card.</p>
          </div>
          <div style="display:flex;gap:1rem;margin-bottom:1.5rem;flex-wrap:wrap">
            <div style="flex:1;min-width:180px">
              <label class="field-label">Venue</label>
              <input type="text" id="sc-event-venue" value="${h(config.eventVenue)}" placeholder="e.g. Blochaus Melbourne">
            </div>
            <div style="flex:1;min-width:180px">
              <label class="field-label">Date</label>
              <input type="date" id="sc-event-date" value="${h(config.eventDate)}">
            </div>
          </div>

          <div class="field-label" style="margin-bottom:.5rem">Paper size</div>
          <div class="radio-group">${paperOpts}</div>

          <div style="display:flex;gap:1.5rem;flex-wrap:wrap;margin-bottom:1.25rem">
            <label style="display:flex;align-items:center;gap:.5rem;cursor:pointer;width:fit-content">
              <input type="checkbox" id="sc-zones"${config.zones ? ' checked' : ''}
                style="width:1rem;height:1rem;cursor:pointer;accent-color:#2563eb">
              <span class="field-label" style="margin:0">Zones</span>
            </label>
            <label style="display:flex;align-items:center;gap:.5rem;cursor:pointer;width:fit-content">
              <input type="checkbox" id="sc-judge"${config.judge ? ' checked' : ''}
                style="width:1rem;height:1rem;cursor:pointer;accent-color:#2563eb">
              <span class="field-label" style="margin:0">Include Judge column</span>
            </label>
          </div>

          ${hasData ? `
            <div class="field-label" style="margin-bottom:.5rem">Athlete details</div>
            <div class="radio-group">${mergeOpts}</div>
          ` : `
            <div style="max-width:220px">
              <label class="field-label">Number of blank cards</label>
              <input type="number" id="sc-blank-count" min="1" max="500" value="${blankCount}">
            </div>
          `}
      </div>`;
  }

  function readConfigFields() {
    config.eventName  = document.getElementById('sc-event-name').value.trim();
    config.instructionText = document.getElementById('sc-instruction-text').value.trim();
    config.eventDate  = document.getElementById('sc-event-date').value.trim();
    config.eventVenue = document.getElementById('sc-event-venue').value.trim();
    config.judge      = document.getElementById('sc-judge').checked;
    config.zones      = document.getElementById('sc-zones').checked;
    if (hasData) {
      const mergeEl = document.querySelector('input[name="sc-merge"]:checked');
      config.merge = mergeEl ? mergeEl.value === '1' : true;
    } else {
      config.merge = false;
      const blankEl = document.getElementById('sc-blank-count');
      if (blankEl) blankCount = Math.max(1, Math.min(500, parseInt(blankEl.value, 10) || 20));
    }
  }

  function bindConfig() {
    document.getElementById('sc-back-upload').addEventListener('click', () => { view = 'upload'; render(); });

    document.querySelectorAll('input[name="sc-paper"]').forEach(r => {
      r.addEventListener('change', () => {
        config.paper = r.value;
        saveConfig();
        document.querySelectorAll('input[name="sc-paper"]').forEach(el => el.closest('.radio-opt').classList.toggle('selected', el === r));
      });
    });
    if (hasData) {
      document.querySelectorAll('input[name="sc-merge"]').forEach(r => {
        r.addEventListener('change', () => {
          config.merge = r.value === '1';
          saveConfig();
          render();
        });
      });
    }

    ['sc-event-name', 'sc-instruction-text', 'sc-event-date', 'sc-event-venue', 'sc-zones', 'sc-judge', 'sc-blank-count'].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('change', () => { readConfigFields(); saveConfig(); });
    });

    document.getElementById('sc-goto-design').addEventListener('click', () => {
      readConfigFields();
      if (!config.eventName) { alert('Please enter the event name — it appears at the top of every scorecard.'); return; }
      saveConfig();
      view = 'design';
      render();
    });
  }

  // ── Design ────────────────────────────────────────────────────────────────
  function htmlDesign() {
    const sample = hasData && athletes.length
      ? [...athletes].sort((a, b) => Number(a.bib) - Number(b.bib))[0]
      : null;

    const columnOpts = [0, 1, 2, 3].map(n =>
      `<option value="${n}" ${config.columns === n ? 'selected' : ''}>${n === 0 ? 'Auto' : n}</option>`
    ).join('');

    return `
      <div class="card" id="sc-design-section" style="margin-bottom:1.5rem">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:.75rem">
          <div>
            <h2>Design</h2>
            <p class="subtitle" style="margin:0">${h(config.eventName)}</p>
          </div>
          <div style="display:flex;gap:.5rem;flex-wrap:wrap">
            <button class="btn btn-ghost" id="sc-back-config2">← Edit config</button>
            <button class="btn btn-primary" id="sc-goto-next">${hasData ? 'Select athletes →' : 'Preview →'}</button>
          </div>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:${PAPER.a4.W * SCALE}px 1fr;gap:1.5rem;align-items:start">
        <div style="position:sticky;top:4.5rem">
          <div class="field-label" style="margin-bottom:.5rem">Preview</div>
          <div id="sc-live-preview">${cardHtml(config, sample)}</div>
        </div>

        <div class="card">
          <div style="display:flex;gap:1rem;margin-bottom:1.25rem;flex-wrap:wrap">
            <div style="flex:1;min-width:160px">
              <label class="field-label">Boulders</label>
              <input type="number" id="sc-boulders" min="6" max="30" value="${config.boulders}">
            </div>
            <div style="flex:1;min-width:160px">
              <label class="field-label">Columns</label>
              <select id="sc-columns">${columnOpts}</select>
            </div>
            <div style="flex:1;min-width:160px">
              <label class="field-label">Rows per column</label>
              <input type="number" id="sc-rows" min="5" max="30" placeholder="Auto" value="${config.rows || ''}">
            </div>
          </div>

          <div class="field-label" style="margin-bottom:.5rem">Margins</div>
          <p class="text-muted" style="font-size:.75rem;margin-bottom:.65rem">Extra blank space beyond the design's default edges — e.g. widen the left margin to clear a clipboard clip.</p>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:0 1.5rem;margin-bottom:1.25rem">
            ${sliderRowHtml('Top', 'sc-margin-top', config.marginTop, 0, 30, 1, 'mm')}
            ${sliderRowHtml('Right', 'sc-margin-right', config.marginRight, 0, 30, 1, 'mm')}
            ${sliderRowHtml('Bottom', 'sc-margin-bottom', config.marginBottom, 0, 30, 1, 'mm')}
            ${sliderRowHtml('Left', 'sc-margin-left', config.marginLeft, 0, 30, 1, 'mm')}
          </div>

          <div class="field-label" style="margin-bottom:.5rem">Text position</div>
          <p class="text-muted" style="font-size:.75rem;margin-bottom:.65rem">Nudge the category and detail text up or down from their default position.</p>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:0 1.5rem;margin-bottom:1.25rem">
            ${sliderRowHtml('Category', 'sc-category-offset', config.categoryOffset, -15, 30, 1, 'mm')}
            ${sliderRowHtml('Detail text', 'sc-instruction-offset', config.instructionOffset, -15, 30, 1, 'mm')}
          </div>

          ${(hasData && config.merge) ? `
            <div style="display:flex;gap:1.5rem;flex-wrap:wrap">
              <label style="display:flex;align-items:center;gap:.5rem;cursor:pointer;width:fit-content">
                <input type="checkbox" id="sc-labels"${config.labels ? ' checked' : ''}
                  style="width:1rem;height:1rem;cursor:pointer;accent-color:#2563eb">
                <span class="field-label" style="margin:0">Labels</span>
              </label>
              <label style="display:flex;align-items:center;gap:.5rem;cursor:pointer;width:fit-content">
                <input type="checkbox" id="sc-lines"${config.lines ? ' checked' : ''}
                  style="width:1rem;height:1rem;cursor:pointer;accent-color:#2563eb">
                <span class="field-label" style="margin:0">Lines</span>
              </label>
            </div>
          ` : ''}
        </div>
      </div>`;
  }

  function readDesignFields() {
    config.boulders   = Math.max(6, Math.min(30, parseInt(document.getElementById('sc-boulders').value, 10) || 20));
    config.columns    = Math.max(0, Math.min(3, parseInt(document.getElementById('sc-columns').value, 10) || 0));
    const rowsVal      = document.getElementById('sc-rows').value.trim();
    config.rows       = rowsVal ? Math.max(5, Math.min(30, parseInt(rowsVal, 10) || 0)) : 0;
    config.marginTop    = Math.max(0, Math.min(30, parseInt(document.getElementById('sc-margin-top').value, 10) || 0));
    config.marginRight  = Math.max(0, Math.min(30, parseInt(document.getElementById('sc-margin-right').value, 10) || 0));
    config.marginBottom = Math.max(0, Math.min(30, parseInt(document.getElementById('sc-margin-bottom').value, 10) || 0));
    config.marginLeft   = Math.max(0, Math.min(30, parseInt(document.getElementById('sc-margin-left').value, 10) || 0));
    config.categoryOffset    = Math.max(-15, Math.min(30, parseInt(document.getElementById('sc-category-offset').value, 10) || 0));
    config.instructionOffset = Math.max(-15, Math.min(30, parseInt(document.getElementById('sc-instruction-offset').value, 10) || 0));
    if (hasData && config.merge) {
      const labelsEl = document.getElementById('sc-labels');
      const linesEl  = document.getElementById('sc-lines');
      if (labelsEl) config.labels = labelsEl.checked;
      if (linesEl)  config.lines  = linesEl.checked;
    }
  }

  function refreshPreview() {
    const sample = hasData && athletes.length
      ? [...athletes].sort((a, b) => Number(a.bib) - Number(b.bib))[0]
      : null;
    const el = document.getElementById('sc-live-preview');
    if (el) el.innerHTML = cardHtml(config, sample);
  }

  function bindDesign() {
    document.getElementById('sc-back-config2').addEventListener('click', () => { view = 'config'; render(); });

    ['sc-boulders', 'sc-columns', 'sc-rows'].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('change', () => { readDesignFields(); saveConfig(); refreshPreview(); });
    });

    document.getElementById('sc-goto-next').addEventListener('click', () => {
      if (hasData) {
        selectedBibs     = new Set();
        selectFilterCat  = new Set();
        selectFilterDisc = '';
        selectFilterName = '';
        view = 'select';
      } else {
        view = 'preview';
      }
      render();
    });

    ['sc-margin-top', 'sc-margin-right', 'sc-margin-bottom', 'sc-margin-left', 'sc-category-offset', 'sc-instruction-offset'].forEach(id => {
      const slider = document.getElementById(id);
      const valEl  = document.getElementById(`${id}-val`);
      if (!slider) return;
      slider.addEventListener('input', () => {
        if (valEl) valEl.textContent = slider.value + 'mm';
        readDesignFields();
        saveConfig();
        refreshPreview();
      });
    });

    ['sc-labels', 'sc-lines'].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('change', () => { readDesignFields(); saveConfig(); refreshPreview(); });
    });
  }

  // ── Select ────────────────────────────────────────────────────────────────
  function visibleBibIds() {
    const bibs = [];
    document.querySelectorAll('#sc-sel-table tbody tr').forEach(tr => {
      if (tr.style.display !== 'none') bibs.push(tr.dataset.bib);
    });
    return bibs;
  }

  function updateSelectCount() {
    const el = document.getElementById('sc-sel-count');
    if (el) el.textContent = `${selectedBibs.size} of ${athletes.length} selected`;
  }

  function applySelectFilter() {
    const nameQ = selectFilterName.toLowerCase().trim();
    const discQ = selectFilterDisc.toLowerCase();
    document.querySelectorAll('#sc-sel-table tbody tr').forEach(tr => {
      const matchCat  = selectFilterCat.size === 0 || selectFilterCat.has(tr.dataset.cat);
      const matchDisc = !discQ || tr.dataset.disc.split('|').includes(discQ);
      const matchName = !nameQ || tr.dataset.name.includes(nameQ);
      tr.style.display = (matchCat && matchDisc && matchName) ? '' : 'none';
    });
    updateSelectAllBtn();
  }

  function updateSelectAllBtn() {
    const btn = document.getElementById('sc-sel-select-all');
    if (!btn) return;
    const isFiltered = selectFilterCat.size > 0 || selectFilterDisc || selectFilterName.trim();
    btn.textContent = isFiltered ? `Select visible (${visibleBibIds().length})` : 'Select all';
  }

  function catFilterLabel() {
    const n = selectFilterCat.size;
    if (n === 0) return 'All categories';
    if (n === 1) return [...selectFilterCat][0];
    return `${n} categories`;
  }

  function updateCatFilterLabel() {
    const el = document.getElementById('sc-catfilter-label');
    if (el) el.textContent = catFilterLabel();
  }

  function htmlSelect() {
    const sorted = [...athletes].sort((a, b) => Number(a.bib) - Number(b.bib));
    const cats   = [...new Set(athletes.map(a => a.ageGender).filter(Boolean))].sort();
    const discs  = [...new Set(athletes.flatMap(a => a.disciplines))].sort();

    const catCheckboxes = cats.map(c => `
      <label class="sc-catfilter-item">
        <input type="checkbox" class="sc-catfilter-chk" value="${h(c)}"${selectFilterCat.has(c) ? ' checked' : ''}>
        ${h(c)}
      </label>`).join('');

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
          <input type="checkbox" class="sc-sel-chk" data-bib="${h(a.bib)}"${selectedBibs.has(a.bib) ? ' checked' : ''}>
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
            <h2>Select Athletes</h2>
            <p class="subtitle" style="margin:0"><span id="sc-sel-count">${selectedBibs.size} of ${athletes.length} selected</span></p>
          </div>
          <div style="display:flex;gap:.5rem;flex-wrap:wrap">
            <button class="btn btn-ghost" id="sc-back-design3">← Edit design</button>
            <button class="btn btn-primary" id="sc-goto-preview">Preview selected →</button>
          </div>
        </div>
      </div>

      <div class="card">
        <div style="display:flex;align-items:center;gap:.65rem;flex-wrap:wrap;margin-bottom:1rem">
          <div id="sc-catfilter-wrap" style="position:relative;flex:1;min-width:160px">
            <button type="button" class="btn btn-ghost" id="sc-catfilter-btn" style="width:100%;justify-content:space-between;font-weight:400;color:#1e293b">
              <span id="sc-catfilter-label">${catFilterLabel()}</span>
              <span style="opacity:.6">▾</span>
            </button>
            <div class="sc-catfilter-panel" id="sc-catfilter-panel" style="display:none">${catCheckboxes}</div>
          </div>
          <select id="sc-sel-disc-filter" style="flex:1;min-width:130px">${discOptions}</select>
          <input type="text" id="sc-sel-name-filter" placeholder="Search by name…"
            value="${h(selectFilterName)}" style="flex:1;min-width:150px">
          <button class="btn btn-ghost" id="sc-sel-select-all"
            style="font-size:.8rem;padding:.3rem .75rem;white-space:nowrap">Select all</button>
          <button class="btn btn-ghost" id="sc-sel-clear-all"
            style="font-size:.8rem;padding:.3rem .75rem;white-space:nowrap">Clear all</button>
        </div>

        <div style="overflow-x:auto">
          <table id="sc-sel-table" style="width:100%;border-collapse:collapse;font-size:.875rem">
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
    document.getElementById('sc-back-design3').addEventListener('click', () => { view = 'design'; render(); });

    document.getElementById('sc-goto-preview').addEventListener('click', () => {
      if (!selectedBibs.size) { alert('Please select at least one athlete to preview.'); return; }
      view = 'preview';
      render();
    });

    const catFilterBtn   = document.getElementById('sc-catfilter-btn');
    const catFilterPanel = document.getElementById('sc-catfilter-panel');
    const discFilter = document.getElementById('sc-sel-disc-filter');
    const nameFilter = document.getElementById('sc-sel-name-filter');

    catFilterBtn.addEventListener('click', e => {
      e.stopPropagation();
      catFilterPanel.style.display = catFilterPanel.style.display === 'none' ? 'block' : 'none';
    });
    document.querySelectorAll('.sc-catfilter-chk').forEach(chk => {
      chk.addEventListener('change', () => {
        if (chk.checked) selectFilterCat.add(chk.value);
        else selectFilterCat.delete(chk.value);
        updateCatFilterLabel();
        applySelectFilter();
      });
    });
    document.addEventListener('click', function outsideClick(e) {
      const wrap = document.getElementById('sc-catfilter-wrap');
      if (!wrap) { document.removeEventListener('click', outsideClick); return; }
      if (!wrap.contains(e.target)) {
        const panel = document.getElementById('sc-catfilter-panel');
        if (panel) panel.style.display = 'none';
      }
    });
    discFilter.addEventListener('change', () => { selectFilterDisc = discFilter.value; applySelectFilter(); });
    nameFilter.addEventListener('input', () => { selectFilterName = nameFilter.value; applySelectFilter(); });

    applySelectFilter();

    document.getElementById('sc-sel-select-all').addEventListener('click', () => {
      visibleBibIds().forEach(bib => selectedBibs.add(bib));
      document.querySelectorAll('#sc-sel-table tbody tr').forEach(tr => {
        if (tr.style.display !== 'none') tr.querySelector('.sc-sel-chk').checked = true;
      });
      updateSelectCount();
    });

    document.getElementById('sc-sel-clear-all').addEventListener('click', () => {
      selectedBibs.clear();
      document.querySelectorAll('.sc-sel-chk').forEach(chk => { chk.checked = false; });
      updateSelectCount();
    });

    document.querySelectorAll('.sc-sel-chk').forEach(chk => {
      chk.addEventListener('change', () => {
        if (chk.checked) selectedBibs.add(chk.dataset.bib);
        else selectedBibs.delete(chk.dataset.bib);
        updateSelectCount();
      });
    });
  }

  // ── Preview ───────────────────────────────────────────────────────────────
  function htmlPreview() {
    const cards = hasData
      ? athletes.filter(a => selectedBibs.has(a.bib)).sort((a, b) => Number(a.bib) - Number(b.bib))
      : Array.from({ length: blankCount });
    const n = cards.length;
    return `
      <div class="card" id="sc-config-section" style="margin-bottom:1.5rem">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:.75rem">
          <div>
            <h2>Scorecard Preview</h2>
            <p class="subtitle" style="margin:0">${n} card${n === 1 ? '' : 's'} · ${h(config.eventName)}</p>
          </div>
          <div style="display:flex;gap:.5rem;flex-wrap:wrap">
            <button class="btn btn-ghost" id="sc-back-preview">← ${hasData ? 'Edit selection' : 'Edit design'}</button>
            <button class="btn btn-primary" id="sc-print">🖨 Print scorecards</button>
          </div>
        </div>
        <p style="font-size:.82rem;color:#475569;margin:.6rem 0 0">
          Tip: in the print dialog, set the destination to <strong>Save as PDF</strong>
          to save a file — then print from the PDF whenever needed.
        </p>
      </div>
      <div id="sc-cards">
        ${cards.map(a => cardHtml(config, hasData ? a : null)).join('')}
      </div>`;
  }

  function bindPreview() {
    document.getElementById('sc-back-preview').addEventListener('click', () => {
      view = hasData ? 'select' : 'design';
      render();
    });
    document.getElementById('sc-print').addEventListener('click', async () => {
      const prev = document.title;
      const n = hasData ? selectedBibs.size : blankCount;
      document.title = config.eventName
        ? `${config.eventName} - ${n} Scorecard${n === 1 ? '' : 's'}`
        : `${n} Scorecard${n === 1 ? '' : 's'}`;
      const pageSizeEl = document.getElementById('scorecard-page-size');
      if (pageSizeEl) {
        pageSizeEl.textContent = `@page{size:${config.paper === 'a4' ? 'A4' : 'A5'} landscape;margin:0}`;
      }
      if (document.fonts && document.fonts.ready) {
        try { await document.fonts.ready; } catch {}
      }
      window.print();
      window.addEventListener('afterprint', () => {
        document.title = prev;
        if (pageSizeEl) pageSizeEl.textContent = '';
      }, { once: true });
    });
  }

  // ── Render & bind ─────────────────────────────────────────────────────────
  function render() {
    const el = document.getElementById('scorecard-content');
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

  // ── Mode switching ────────────────────────────────────────────────────────
  function exitScorecards() {
    document.getElementById('scorecard-content').style.display = 'none';
    document.getElementById('content').style.display           = '';
    App.goTo(0);
  }

  // ── Public API ────────────────────────────────────────────────────────────
  function init() {
    document.getElementById('step-nav').innerHTML = `
      <div style="flex:1;display:flex;align-items:center;gap:.65rem;padding:0 .5rem">
        <button id="sc-nav-home" style="
          background:rgba(255,255,255,.15);border:1px solid rgba(255,255,255,.3);
          color:#fff;border-radius:.375rem;padding:.25rem .65rem;
          font-size:.78rem;cursor:pointer;white-space:nowrap">← Home</button>
        <span style="color:rgba(255,255,255,.7);font-size:.88rem;font-weight:600">Scorecard Generator</span>
      </div>`;
    document.getElementById('sc-nav-home').addEventListener('click', exitScorecards);

    document.getElementById('content').style.display     = 'none';
    document.getElementById('bib-content').style.display = 'none';
    document.getElementById('scorecard-content').style.display = '';

    if (!['config', 'design', 'select', 'preview'].includes(view)) view = 'upload';
    render();
  }

  return { init };
})();
