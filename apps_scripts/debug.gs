function exportAllCombinations_DEBUG() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const extractSheet = ss.getSheetByName('EXTRACT');
  
  const data = extractSheet.getRange(2, 1, extractSheet.getLastRow() - 1, extractSheet.getLastColumn()).getValues();
  
  const COL_I = 8;
  const COL_J = 9;
  const COL_K = 10;
  const COL_L = 11;
  const COL_M = 12;
  const COL_S = 18;
  const COL_W = 22;

  // DEBUG: just test one combination
  const age = 'U19';
  const gender = 'Female';
  const discipline = 'Lead';
  const category = `${age} ${gender}`;

  const filtered = data.filter(row => {
    return String(row[COL_W]).includes(discipline) && 
           String(row[COL_S]).startsWith(category);
  });

  // DEBUG: only show first 5 rows
  Logger.log(`Total matching rows: ${filtered.length}`);
  filtered.slice(0, 5).forEach((row, i) => {
    const dateVal = row[COL_M];
    const dateStr = dateVal instanceof Date
      ? Utilities.formatDate(dateVal, Session.getScriptTimeZone(), 'yyyy-MM-dd')
      : String(dateVal);
    Logger.log(`Row ${i+1}: J=${row[COL_J]}, K=${row[COL_K]}, L=${row[COL_L]}, M=${dateStr}, I=${row[COL_I]}`);
  });
}
