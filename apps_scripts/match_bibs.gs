// ============================================================
// CONFIGURATION — adjust these after running inspectVLHeaders()
// ============================================================

const CONFIG = {
  // Name of the sheet tab where you imported the Vertical Life CSV
  vlSheetName: 'VERTICAL_LIFE',

  // Name of your data sheet
  extractSheetName: 'EXTRACT',

  // --- Vertical Life sheet columns (0-based index) ---
  // Run inspectVLHeaders() first to find these
  vl_firstName:  0,   // e.g. column B
  vl_lastName:   1,   // e.g. column A
  vl_dob:        8,   // e.g. column C (date of birth)
  vl_bib:        3,   // e.g. column D (bib number)

  // --- EXTRACT sheet columns (0-based index) ---
  // From our earlier work: J=9, K=10, L=11, M=12
  ex_firstName:  9,   // column J
  ex_lastName:   10,  // column K
  ex_dob:        12,  // column M (date of birth)
  ex_roleColumn: 18,  // column S — Category
  ex_bibTarget:  0,  // column A — where to write the bib (change as needed)

};

// ============================================================
// STEP 1: Run this first to see the Vertical Life column headers
// ============================================================
function inspectVLHeaders() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const vlSheet = ss.getSheetByName(CONFIG.vlSheetName);
  if (!vlSheet) {
    SpreadsheetApp.getUi().alert(`Sheet "${CONFIG.vlSheetName}" not found! Import the CSV first.`);
    return;
  }
  const headers = vlSheet.getRange(1, 1, 1, vlSheet.getLastColumn()).getValues()[0];
  headers.forEach((h, i) => {
    Logger.log(`Column ${i} (${columnLetter(i+1)}): "${h}"`);
  });
  SpreadsheetApp.getUi().alert(
    'Column headers logged! Open View > Logs to see them, then update CONFIG at the top of the script.'
  );
}

// ============================================================
// STEP 2: Debug — check matches before writing anything
// ============================================================
function matchBibs_DEBUG() {
  const { matched, unmatched, vlData } = runMatch_();
  Logger.log(`=== Vertical Life athletes: ${vlData.length} ===`);
  Logger.log(`=== Matched: ${matched.length} | Unmatched in EXTRACT: ${unmatched.length} ===`);

  Logger.log('\n--- First 10 matches ---');
  matched.slice(0, 10).forEach(m => {
    Logger.log(`MATCH: "${m.firstName} ${m.lastName}" DOB=${m.dob} → Bib=${m.bib} (EXTRACT row ${m.extractRow})`);
  });

  if (unmatched.length > 0) {
    Logger.log('\n--- Unmatched EXTRACT rows (first 10) ---');
    unmatched.slice(0, 10).forEach(u => {
      Logger.log(`NO MATCH: "${u.firstName} ${u.lastName}" DOB=${u.dob} (EXTRACT row ${u.extractRow})`);
    });
  }
}

// ============================================================
// STEP 3: Write bib numbers into EXTRACT (safe to re-run)
// ============================================================
function matchAndWriteBibs() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const extractSheet = ss.getSheetByName(CONFIG.extractSheetName);
  const { matched, unmatched } = runMatch_();

  if (matched.length === 0) {
    SpreadsheetApp.getUi().alert('No matches found! Run matchBibs_DEBUG() first to check your CONFIG column settings.');
    return;
  }

  // Write bib numbers
  matched.forEach(m => {
    // extractRow is 1-based (row in the sheet), data starts row 2
    extractSheet.getRange(m.extractRow, CONFIG.ex_bibTarget + 1).setValue(m.bib);
  });

  SpreadsheetApp.getUi().alert(
    `Done!\n✅ Bib numbers written: ${matched.length}\n⚠️ Unmatched athletes: ${unmatched.length}\n\nRun matchBibs_DEBUG() to see who didn't match.`
  );
}

// ============================================================
// Internal matching logic
// ============================================================
function runMatch_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const vlSheet = ss.getSheetByName(CONFIG.vlSheetName);
  const extractSheet = ss.getSheetByName(CONFIG.extractSheetName);

  if (!vlSheet || !extractSheet) {
    throw new Error(`Could not find sheets. Check CONFIG.vlSheetName and CONFIG.extractSheetName.`);
  }

  const tz = ss.getSpreadsheetTimeZone();

  // Read Vertical Life data (skip header row 1)
  const vlLastRow = vlSheet.getLastRow();
  const vlLastCol = vlSheet.getLastColumn();
  const vlRaw = vlSheet.getRange(2, 1, vlLastRow - 1, vlLastCol).getValues();

  // Build a lookup map: "firstname|lastname|dob" → bib
  const vlMap = {};
  const vlData = [];
  vlRaw.forEach(row => {
    const firstName = normalize_(String(row[CONFIG.vl_firstName]));
    const lastName  = normalize_(String(row[CONFIG.vl_lastName]));
    const dob       = formatDob_(row[CONFIG.vl_dob], tz);
    const bib       = String(row[CONFIG.vl_bib]).trim();
    const key       = `${firstName}|${lastName}|${dob}`;
    vlMap[key] = bib;
    vlData.push({ firstName, lastName, dob, bib });
  });

  // Read EXTRACT data (starts row 2)
  const exLastRow = extractSheet.getLastRow();
  const exLastCol = extractSheet.getLastColumn();
  const exRaw = extractSheet.getRange(2, 1, exLastRow - 1, exLastCol).getValues();

  const matched = [];
  const unmatched = [];

  exRaw.forEach((row, i) => {
    // Skip coaches and managers
    const category = normalize_(String(row[CONFIG.ex_roleColumn]));
    if (category === 'manager' || category === 'coach') return;
    
    const firstName = normalize_(String(row[CONFIG.ex_firstName]));
    const lastName  = normalize_(String(row[CONFIG.ex_lastName]));
      
    // Skip blank rows
    if (!firstName && !lastName) return; 
    
    const dob       = formatDob_(row[CONFIG.ex_dob], tz);
    const key       = `${firstName}|${lastName}|${dob}`;
    const extractRow = i + 2; // +2 because data starts row 2, i is 0-based

    if (vlMap[key]) {
      matched.push({ firstName, lastName, dob, bib: vlMap[key], extractRow });
    } else {
      unmatched.push({ firstName, lastName, dob, extractRow });
    }
  });

  return { matched, unmatched, vlData };
}

// Normalise strings for matching: lowercase, trim whitespace
function normalize_(str) {
  return str.toLowerCase().trim();
}

// Format a date value as yyyy-MM-dd for consistent matching
function formatDob_(val, tz) {
  if (val instanceof Date) {
    return Utilities.formatDate(val, tz, 'yyyy-MM-dd');
  }
  // Already a string — normalise separators
  return String(val).trim().replace(/\//g, '-');
}

// Helper: convert column number (1-based) to letter (A, B, ... Z, AA...)
function columnLetter(col) {
  let letter = '';
  while (col > 0) {
    const rem = (col - 1) % 26;
    letter = String.fromCharCode(65 + rem) + letter;
    col = Math.floor((col - 1) / 26);
  }
  return letter;
}
