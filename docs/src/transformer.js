const Transformer = (() => {

  function getUniqueValues(rows, colName) {
    const seen = new Set();
    for (const row of rows) {
      seen.add(String(row[colName] ?? '').trim());
    }
    return [...seen].sort((a, b) => {
      if (a === '' && b !== '') return 1;
      if (b === '' && a !== '') return -1;
      return a.localeCompare(b);
    });
  }

  // Returns {value: count} for every unique value in a column
  function getValueCounts(rows, colName) {
    const counts = {};
    for (const row of rows) {
      const val = String(row[colName] ?? '').trim();
      counts[val] = (counts[val] || 0) + 1;
    }
    return counts;
  }

  function safeSlug(str) {
    return String(str)
      .trim()
      .replace(/[^a-zA-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  // "Female,Gender Diverse" → "Female" for filename; full value kept in CSV row
  function genderSlug(genderVal) {
    const first = String(genderVal).split(',')[0].trim();
    return safeSlug(first) || 'Unknown';
  }

  function buildCsvRow(fields) {
    return fields
      .map(v => `"${String(v ?? '').replace(/"/g, '""')}"`)
      .join(',');
  }

  // Returns all matching discipline labels for a row (a value like "Lead & Boulder"
  // may match multiple rules and the athlete is written to each discipline's file).
  function resolveDisciplines(row, state) {
    if (!state.multiDiscipline) {
      return [state.disciplineFixed || 'Unknown'];
    }
    const colVal = String(row[state.disciplineColumn] ?? '').trim();
    const matched = state.disciplineRules
      .filter(r => r.contains && colVal.toLowerCase().includes(r.contains.toLowerCase()))
      .map(r => r.label);
    return matched.length ? matched : [null];
  }

  function isRowIncluded(row, state) {
    if (!state.filters || !state.filters.length) return true;
    for (const f of state.filters) {
      if (!f.column) continue;
      const val  = String(row[f.column] ?? '').trim();
      const mode = f.mode || 'values';
      if (mode === 'blank') {
        if (val === '') return false;
      } else if (mode === 'contains') {
        if (!f.contains) continue;
        const haystack = f.caseSensitive ? val : val.toLowerCase();
        const needle   = f.caseSensitive ? f.contains : f.contains.toLowerCase();
        if (haystack.includes(needle)) return false;
      } else {
        if (!f.excluded.length) continue;
        if (f.excluded.includes(val)) return false;
      }
    }
    return true;
  }

  function generateOutputFiles(state) {
    const { rows, columnMap, categoryConfig } = state;
    const buckets = {};

    function push(filename, csvRow, isWarning = false) {
      if (!buckets[filename]) buckets[filename] = { rows: [], isWarning };
      buckets[filename].rows.push(csvRow);
    }

    for (const row of rows) {
      // Apply status/payment filter first
      if (!isRowIncluded(row, state)) continue;

      const firstName = String(row[columnMap.firstName] ?? '').trim();
      const lastName  = String(row[columnMap.lastName]  ?? '').trim();
      const gender    = String(row[columnMap.gender]    ?? '').trim();
      const dob       = Parser.normalizeDate(row[columnMap.dob]);
      const stateVal  = String(row[columnMap.state]     ?? '').trim();
      const catRaw    = String(row[columnMap.category]  ?? '').trim();

      const csvRow = buildCsvRow([firstName, lastName, gender, dob, stateVal]);
      const catConf = categoryConfig[catRaw];

      if (!catConf) {
        push('_uncategorised.csv', csvRow, true);
        continue;
      }

      if (catConf.type === 'exclude') continue;

      const label = safeSlug(catConf.label) || 'Unknown';

      if (catConf.type === 'official') {
        push(`${label}.csv`, csvRow);
      } else {
        const gPart       = genderSlug(gender);
        const disciplines = resolveDisciplines(row, state);
        for (const disc of disciplines) {
          const discPart = disc ? safeSlug(disc) : 'Unknown';
          push(`${label}_${gPart}_${discPart}.csv`, csvRow);
        }
      }
    }

    return Object.entries(buckets)
      .map(([filename, data]) => ({
        filename,
        content:   data.rows.join('\n'),
        count:     data.rows.length,
        isWarning: data.isWarning,
      }))
      .sort((a, b) => {
        if (a.isWarning !== b.isWarning) return a.isWarning ? 1 : -1;
        return a.filename.localeCompare(b.filename);
      });
  }

  return { getUniqueValues, getValueCounts, generateOutputFiles, isRowIncluded };
})();
