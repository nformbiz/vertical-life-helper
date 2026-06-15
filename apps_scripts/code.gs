function exportAllCombinations() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const extractSheet = ss.getSheetByName('EXTRACT');
  
  if (!extractSheet) {
    SpreadsheetApp.getUi().alert('Sheet "EXTRACT" not found!');
    return;
  }
  
  const ages = ['U15', 'U17', 'U19'];
  const genders = ['Male', 'Female'];
  const disciplines = ['Lead', 'Boulder'];
  
  // Get all data from row 2 onwards (skip header row)
  const lastRow = extractSheet.getLastRow();
  const lastCol = extractSheet.getLastColumn();
  const data = extractSheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  
  // Column indices (0-based, so A=0, B=1, etc.)
  const COL_I = 8;
  const COL_J = 9;
  const COL_K = 10;
  const COL_L = 11;
  const COL_M = 12;  // Date column
  const COL_S = 18;  // Category e.g. 'U19 Female'
  const COL_W = 22;  // Discipline e.g. 'Lead'
  
  // Create or find the export folder in Drive
  const folderName = 'Verticle Life Exports';
  let folder;
  const folders = DriveApp.getFoldersByName(folderName);
  folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(folderName);
  
  let count = 0;
  
  ages.forEach(age => {
    genders.forEach(gender => {
      disciplines.forEach(discipline => {
        const category = `${age} ${gender}`;
        
        // Filter matching rows
        const filtered = data.filter(row => {
          return String(row[COL_W]).toLowerCase().includes(discipline.toLowerCase()) && 
         String(row[COL_S]).toLowerCase().startsWith(category.toLowerCase());
});
        
        // Build CSV content
        const csvRows = filtered.map(row => {
          const dateVal = row[COL_M];
          const dateStr = dateVal instanceof Date
            ? Utilities.formatDate(dateVal, ss.getSpreadsheetTimeZone(), 'yyyy-MM-dd')
            : String(dateVal);
          
          return [row[COL_J], row[COL_K], row[COL_L], dateStr, row[COL_I]]
            .map(val => `"${String(val).replace(/"/g, '""')}"`)
            .join(',');
        });
        
        const fileName = `${age}_${gender}_${discipline}.csv`;
        
        // Remove existing file if re-running
        const existing = folder.getFilesByName(fileName);
        while (existing.hasNext()) existing.next().setTrashed(true);
        
        folder.createFile(fileName, csvRows.join('\n'), MimeType.CSV);
        Logger.log(`Created: ${fileName} (${filtered.length} rows)`);
        count++;
      });
    });
  });
  
  SpreadsheetApp.getUi().alert(`Done! ${count} CSV files saved to Google Drive folder "${folderName}".`);
}

function exportCoachesAndManagers() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const extractSheet = ss.getSheetByName('EXTRACT');
  if (!extractSheet) {
    SpreadsheetApp.getUi().alert('Sheet "EXTRACT" not found!');
    return;
  }

  const tz = ss.getSpreadsheetTimeZone();
  const roles    = ['Coach', 'Manager'];
  const genders  = ['Male', 'Female'];

  const COL_I = 8;
  const COL_J = 9;
  const COL_K = 10;
  const COL_L = 11;
  const COL_M = 12;
  const COL_S = 18;  // Category — "Coach" or "Manager"

  const lastRow = extractSheet.getLastRow();
  const lastCol = extractSheet.getLastColumn();
  const data = extractSheet.getRange(2, 1, lastRow - 1, lastCol).getValues();

  const folderName = 'Verticle Life Exports';
  let folder;
  const folders = DriveApp.getFoldersByName(folderName);
  folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(folderName);

  let count = 0;

  roles.forEach(role => {
    genders.forEach(gender => {
      const filtered = data.filter(row => {
        const category = String(row[COL_S]).trim().toLowerCase();
        const rowGender = String(row[COL_L]).trim().toLowerCase();
        return category === role.toLowerCase() && rowGender === gender.toLowerCase();
      });

      const csvRows = filtered.map(row => {
        const dateVal = row[COL_M];
        const dateStr = dateVal instanceof Date
          ? Utilities.formatDate(dateVal, tz, 'yyyy-MM-dd')
          : String(dateVal);
        return [row[COL_J], row[COL_K], row[COL_L], dateStr, row[COL_I]]
          .map(val => `"${String(val).replace(/"/g, '""')}"`)
          .join(',');
      });

      const fileName = `${role}_${gender}.csv`;
      const existing = folder.getFilesByName(fileName);
      while (existing.hasNext()) existing.next().setTrashed(true);
      folder.createFile(fileName, csvRows.join('\n'), MimeType.CSV);
      Logger.log(`Created: ${fileName} (${filtered.length} rows)`);
      count++;
    });
  });

  SpreadsheetApp.getUi().alert(`Done! ${count} CSV files saved to Google Drive folder "${folderName}".`);
}
