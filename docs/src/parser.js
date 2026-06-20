const Parser = (() => {
  const MONTHS = {
    jan:1, feb:2, mar:3, apr:4, may:5, jun:6,
    jul:7, aug:8, sep:9, oct:10, nov:11, dec:12,
  };

  function normalizeDate(val) {
    if (val == null || val === '') return '';

    if (val instanceof Date) {
      if (isNaN(val.getTime())) return '';
      const y = val.getFullYear();
      const m = String(val.getMonth() + 1).padStart(2, '0');
      const d = String(val.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }

    const str = String(val).trim();

    // Already yyyy-MM-dd
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;

    // "30 Nov 2015" or "30 November 2015" (Wild Apricot XLS format)
    const longMatch = str.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
    if (longMatch) {
      const day   = longMatch[1].padStart(2, '0');
      const mon   = MONTHS[longMatch[2].toLowerCase().slice(0, 3)];
      const year  = longMatch[3];
      if (mon) return `${year}-${String(mon).padStart(2, '0')}-${day}`;
    }

    // DD/MM/YYYY (Australian convention)
    const slashMatch = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (slashMatch) {
      return `${slashMatch[3]}-${slashMatch[2].padStart(2,'0')}-${slashMatch[1].padStart(2,'0')}`;
    }

    // MM-DD-YYYY  or  YYYY/MM/DD  — fall back to Date parse
    const d = new Date(str);
    if (!isNaN(d.getTime())) return normalizeDate(d);

    return str; // give up, return as-is
  }

  // Stable fingerprint of a header row — used as localStorage key
  function hashHeaders(headers) {
    const str = [...headers].sort().join('|').toLowerCase();
    let h = 5381;
    for (let i = 0; i < str.length; i++) {
      h = (((h << 5) + h) ^ str.charCodeAt(i)) >>> 0;
    }
    return h.toString(36);
  }

  async function parseFile(file) {
    const name = file.name.toLowerCase();
    if (name.endsWith('.csv')) return parseCsv(file);
    if (name.endsWith('.xls') || name.endsWith('.xlsx')) return parseXls(file);
    throw new Error(`Unsupported file type: ${file.name}. Please use XLS, XLSX, or CSV.`);
  }

  function parseCsv(file) {
    return new Promise((resolve, reject) => {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete(result) {
          if (!result.data.length) { reject(new Error('CSV file is empty')); return; }
          resolve({ headers: result.meta.fields || [], rows: result.data });
        },
        error(err) { reject(new Error(err.message)); },
      });
    });
  }

  function parseXls(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => {
        try {
          const wb = XLSX.read(e.target.result, { type: 'array', cellDates: true });
          const ws = wb.Sheets[wb.SheetNames[0]];
          // raw:false gives us formatted strings; cellDates means date cells become Date objects
          const raw = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, dateNF: 'yyyy-mm-dd' });

          if (!raw.length) { reject(new Error('Spreadsheet is empty')); return; }

          const headers = raw[0].map(h => String(h ?? '').trim());
          const rows = [];

          for (let i = 1; i < raw.length; i++) {
            const row = {};
            let hasValue = false;
            headers.forEach((h, j) => {
              const v = raw[i][j] ?? '';
              row[h] = v;
              if (v !== '') hasValue = true;
            });
            if (hasValue) rows.push(row);
          }

          resolve({ headers, rows });
        } catch (err) {
          reject(new Error(`Failed to parse spreadsheet: ${err.message}`));
        }
      };
      reader.onerror = () => reject(new Error('Could not read file'));
      reader.readAsArrayBuffer(file);
    });
  }

  return { parseFile, normalizeDate, hashHeaders };
})();
