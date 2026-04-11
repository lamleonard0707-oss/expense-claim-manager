// ============================================================
// Expense Claim Manager — Google Apps Script
// Deploy as Web App: Execute as Me, Anyone can access
// ============================================================

var SPREADSHEET_ID = '1-hOXqcjWWUnXBDbmSOIRRFJYnARio1rZFwyodRHGgdk';
var DRIVE_FOLDER_ID = '1YR3sfyjILQjrD6XVq9QUYxOLQWVFKGnz';

var HEADERS = [
    'ID', '日期', '項目', '描述', '金額', '貨幣',
    '付款方式', '付款人', '狀態', 'Claim日期', '單據', '建立時間'
];

// ============================================================
// Entry Point
// ============================================================

function doGet(e) {
    try {
        var dataStr = e.parameter.data;
        if (!dataStr) {
            return ContentService.createTextOutput(JSON.stringify({ success: false, error: 'No data' })).setMimeType(ContentService.MimeType.JSON);
        }
        var data = JSON.parse(dataStr);
        return handleRequest(data);
    } catch (err) {
        return ContentService.createTextOutput(JSON.stringify({ success: false, error: err.toString() })).setMimeType(ContentService.MimeType.JSON);
    }
}

function doPost(e) {
    try {
        var data = JSON.parse(e.postData.contents);
        return handleRequest(data);
    } catch (err) {
        return ContentService.createTextOutput(JSON.stringify({ success: false, error: err.toString() })).setMimeType(ContentService.MimeType.JSON);
    }
}

function handleRequest(data) {
    var action = data.action;

    if (action === 'ping') {
        return ContentService.createTextOutput(JSON.stringify({
            success: true,
            pong: true,
            time: new Date().toISOString(),
            spreadsheetId: SPREADSHEET_ID,
            driveFolderId: DRIVE_FOLDER_ID
        })).setMimeType(ContentService.MimeType.JSON);
    }

    if (action === 'drive_check') {
        // Test Drive folder access without doing any upload
        try {
            var folder = DriveApp.getFolderById(DRIVE_FOLDER_ID);
            return ContentService.createTextOutput(JSON.stringify({
                success: true,
                folderName: folder.getName(),
                folderUrl: folder.getUrl(),
                owner: folder.getOwner() ? folder.getOwner().getEmail() : '(no owner — shared drive)'
            })).setMimeType(ContentService.MimeType.JSON);
        } catch (err) {
            return ContentService.createTextOutput(JSON.stringify({
                success: false,
                error: 'getFolderById(' + DRIVE_FOLDER_ID + '): ' + err.toString()
            })).setMimeType(ContentService.MimeType.JSON);
        }
    }

    if (action === 'addRecord') {
        var result = addRecord(data.record, data.photo);
        return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
    }

    if (action === 'updateRecord') {
        var updateResult = updateRecord(data.record);
        return ContentService.createTextOutput(JSON.stringify(updateResult)).setMimeType(ContentService.MimeType.JSON);
    }

    if (action === 'uploadPhoto') {
        var photoLink = uploadPhoto(data.photo, data.record);
        // Update the sheet row with the Drive link (col 11 = 單據)
        if (photoLink) {
            var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
            var found = findRecordById(ss, data.record.id);
            if (found) {
                found.sheet.getRange(found.row, 11).setValue(photoLink);
            }
        }
        return ContentService.createTextOutput(JSON.stringify({ success: true, driveLink: photoLink })).setMimeType(ContentService.MimeType.JSON);
    }

    if (action === 'uploadPhotoChunk') {
        // Chunked photo upload — collect chunks in CacheService, assemble on last chunk
        var cache = CacheService.getScriptCache();
        var recordId = data.record.id;
        var cacheKey = 'photo_chunk_' + recordId + '_' + data.chunkIndex;
        cache.put(cacheKey, data.chunk, 21600); // 6h TTL — safety net for slow uploads

        if (data.chunkIndex === data.totalChunks - 1) {
            // Last chunk — assemble all chunks
            var allChunks = '';
            for (var ci = 0; ci < data.totalChunks; ci++) {
                var ck = 'photo_chunk_' + recordId + '_' + ci;
                var chunkData = cache.get(ck);
                if (!chunkData) {
                    return ContentService.createTextOutput(JSON.stringify({ success: false, error: 'Missing chunk ' + ci + ' (CacheService TTL 5min — too slow?)' })).setMimeType(ContentService.MimeType.JSON);
                }
                allChunks += chunkData;
                cache.remove(ck);
            }
            var fullBase64 = 'data:image/jpeg;base64,' + allChunks;
            var photoResult = uploadPhotoWithDetail(fullBase64, data.record);
            if (photoResult.url) {
                try {
                    var ss2 = SpreadsheetApp.openById(SPREADSHEET_ID);
                    var found2 = findRecordById(ss2, data.record.id);
                    if (found2) {
                        found2.sheet.getRange(found2.row, 11).setValue(photoResult.url);
                    } else {
                        return ContentService.createTextOutput(JSON.stringify({ success: false, error: 'photo uploaded but record row not found in sheet for id=' + data.record.id, driveLink: photoResult.url })).setMimeType(ContentService.MimeType.JSON);
                    }
                } catch (eSheet) {
                    return ContentService.createTextOutput(JSON.stringify({ success: false, error: 'photo uploaded but sheet update failed: ' + eSheet.toString(), driveLink: photoResult.url })).setMimeType(ContentService.MimeType.JSON);
                }
                return ContentService.createTextOutput(JSON.stringify({ success: true, driveLink: photoResult.url, assembledLen: allChunks.length })).setMimeType(ContentService.MimeType.JSON);
            }
            // Photo upload failed — return the actual reason
            return ContentService.createTextOutput(JSON.stringify({ success: false, error: photoResult.error || 'uploadPhoto returned empty URL with no error', assembledLen: allChunks.length })).setMimeType(ContentService.MimeType.JSON);
        }

        return ContentService.createTextOutput(JSON.stringify({ success: true, chunk: data.chunkIndex })).setMimeType(ContentService.MimeType.JSON);
    }

    return ContentService.createTextOutput(JSON.stringify({ success: false, error: 'Unknown action' })).setMimeType(ContentService.MimeType.JSON);
}

// ============================================================
// Add Record
// ============================================================

function addRecord(record, photoBase64) {
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);

    // Check if this record already exists (upsert logic)
    var existing = findRecordById(ss, record.id);
    if (existing) {
        // Record exists — update status and claim date only
        existing.sheet.getRange(existing.row, 9).setValue(record.claimStatus);
        existing.sheet.getRange(existing.row, 10).setNumberFormat('@').setValue(formatHKDateTime(record.claimDate));
        return { success: true, updated: true, row: existing.row, tab: existing.sheet.getName() };
    }

    // Determine tab name from project + month (e.g. "Partyland MK - 2026-04")
    var monthStr = record.paymentDate ? record.paymentDate.substring(0, 7) : getMonthTab();
    var projectName = record.project || '未分類';
    var tabName = projectName + ' - ' + monthStr;
    var sheet = getOrCreateSheet(ss, tabName);

    // Upload photo to Drive if provided
    var photoLink = '';
    if (photoBase64) {
        photoLink = uploadPhoto(photoBase64, record);
    }

    // Find insertion row — before subtotal/grand total rows at bottom
    var lastDataRow = findLastDataRow(sheet);
    var insertRow = lastDataRow + 1;

    sheet.insertRowBefore(insertRow);

    var row = [
        record.id,
        record.paymentDate,
        record.project,
        record.description,
        record.amount,
        record.currency,
        record.paymentMethod,
        record.paidBy,
        record.claimStatus,
        formatHKDateTime(record.claimDate),
        photoLink,
        formatHKDateTime(record.createdAt)
    ];

    var range = sheet.getRange(insertRow, 1, 1, row.length);
    range.setValues([row]);

    // Force date columns as plain text to prevent timezone conversion
    sheet.getRange(insertRow, 10).setNumberFormat('@'); // claimDate
    sheet.getRange(insertRow, 12).setNumberFormat('@'); // createdAt

    // Format amount column (E) as number
    sheet.getRange(insertRow, 5).setNumberFormat('#,##0.00');

    // Rebuild subtotals
    rebuildSubtotals(sheet);

    return { success: true, row: insertRow, tab: tabName };
}

// Search all sheets for a record by ID
function findRecordById(ss, recordId) {
    var sheets = ss.getSheets();
    for (var s = 0; s < sheets.length; s++) {
        var sheet = sheets[s];
        var lastRow = sheet.getLastRow();
        if (lastRow < 2) continue;

        var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
        for (var r = 0; r < ids.length; r++) {
            if (String(ids[r][0]) === String(recordId)) {
                return { sheet: sheet, row: r + 2 };
            }
        }
    }
    return null;
}

// ============================================================
// Update Record (for claim status changes)
// ============================================================

function updateRecord(record) {
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheets = ss.getSheets();

    // Search all tabs for the record by ID
    for (var s = 0; s < sheets.length; s++) {
        var sheet = sheets[s];
        var lastRow = sheet.getLastRow();
        if (lastRow < 2) continue;

        var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
        for (var r = 0; r < ids.length; r++) {
            if (String(ids[r][0]) === String(record.id)) {
                var rowNum = r + 2;
                // Update status (col 9) and claim date (col 10)
                sheet.getRange(rowNum, 9).setValue(record.claimStatus);
                sheet.getRange(rowNum, 10).setNumberFormat('@').setValue(formatHKDateTime(record.claimDate));
                return { success: true, updated: true, tab: sheet.getName(), row: rowNum };
            }
        }
    }

    return { success: false, error: 'Record not found: ' + record.id };
}

// ============================================================
// Sheet Helpers
// ============================================================

// Convert ISO datetime to readable HK time string (prevents Sheets auto-timezone conversion)
function formatHKDateTime(isoStr) {
    if (!isoStr) return '';
    try {
        var d = new Date(isoStr);
        if (isNaN(d.getTime())) return isoStr; // Not a valid date, return as-is
        return Utilities.formatDate(d, 'Asia/Hong_Kong', 'yyyy-MM-dd HH:mm:ss');
    } catch (e) {
        return isoStr;
    }
}

function getMonthTab() {
    // Force Hong Kong timezone (UTC+8)
    var now = new Date();
    var hkTime = Utilities.formatDate(now, 'Asia/Hong_Kong', 'yyyy-MM');
    return hkTime;
}

function getOrCreateSheet(ss, tabName) {
    var sheet = ss.getSheetByName(tabName);
    if (!sheet) {
        sheet = ss.insertSheet(tabName);
        setupSheetHeaders(sheet);
    }
    return sheet;
}

function setupSheetHeaders(sheet) {
    var headerRange = sheet.getRange(1, 1, 1, HEADERS.length);
    headerRange.setValues([HEADERS]);

    // Style headers
    headerRange.setBackground('#4A90D9');
    headerRange.setFontColor('#FFFFFF');
    headerRange.setFontWeight('bold');
    headerRange.setHorizontalAlignment('center');

    // Freeze header row
    sheet.setFrozenRows(1);

    // Set column widths
    sheet.setColumnWidth(1, 80);   // ID
    sheet.setColumnWidth(2, 100);  // 日期
    sheet.setColumnWidth(3, 120);  // 項目
    sheet.setColumnWidth(4, 200);  // 描述
    sheet.setColumnWidth(5, 80);   // 金額
    sheet.setColumnWidth(6, 60);   // 貨幣
    sheet.setColumnWidth(7, 100);  // 付款方式
    sheet.setColumnWidth(8, 80);   // 付款人
    sheet.setColumnWidth(9, 80);   // 狀態
    sheet.setColumnWidth(10, 100); // Claim日期
    sheet.setColumnWidth(11, 80);  // 單據
    sheet.setColumnWidth(12, 160); // 建立時間
}

// Find last row with actual expense data (exclude header, subtotals, grand total)
function findLastDataRow(sheet) {
    var lastRow = sheet.getLastRow();
    if (lastRow <= 1) return 1; // Only header or empty

    // Walk backwards to find last non-summary row
    for (var r = lastRow; r >= 2; r--) {
        var cellA = sheet.getRange(r, 1).getValue();
        var cellC = sheet.getRange(r, 3).getValue();
        // Subtotal/grand total rows have no ID and have specific markers in col C
        if (cellA !== '' && cellA !== '小計' && cellA !== '總計') {
            return r;
        }
        if (cellA === '' && cellC === '') {
            continue; // blank spacer row, skip
        }
    }
    return 1;
}

// ============================================================
// Subtotals per Project + Grand Total
// ============================================================

function rebuildSubtotals(sheet) {
    var lastRow = sheet.getLastRow();

    // Remove existing subtotal/grand total rows (find them first)
    var rowsToDelete = [];
    for (var r = lastRow; r >= 2; r--) {
        var cellA = sheet.getRange(r, 1).getValue();
        if (cellA === '小計' || cellA === '總計' || cellA === '') {
            rowsToDelete.push(r);
        } else {
            break; // Stop at first real data row
        }
    }
    // Delete from bottom up
    for (var i = 0; i < rowsToDelete.length; i++) {
        sheet.deleteRow(rowsToDelete[i]);
    }

    // Re-read data rows after deletion
    var dataLastRow = sheet.getLastRow();
    if (dataLastRow < 2) return;

    var data = sheet.getRange(2, 1, dataLastRow - 1, HEADERS.length).getValues();

    // Group amounts by project
    var projectTotals = {};
    var projectOrder = [];
    data.forEach(function(row) {
        var id = row[0];
        var project = row[2];
        var amount = parseFloat(row[4]) || 0;
        var currency = row[5] || 'HKD';

        if (!id || id === '小計' || id === '總計') return;

        var key = project + '|' + currency;
        if (!projectTotals[key]) {
            projectTotals[key] = { project: project, currency: currency, total: 0 };
            projectOrder.push(key);
        }
        projectTotals[key].total += amount;
    });

    // Append spacer row
    var nextRow = sheet.getLastRow() + 1;
    sheet.getRange(nextRow, 1, 1, HEADERS.length).setValues([new Array(HEADERS.length).fill('')]);
    nextRow++;

    // Append subtotal rows per project
    var grandTotals = {};
    projectOrder.forEach(function(key) {
        var pt = projectTotals[key];
        var subtotalRow = new Array(HEADERS.length).fill('');
        subtotalRow[0] = '小計';
        subtotalRow[2] = pt.project;
        subtotalRow[4] = pt.total;
        subtotalRow[5] = pt.currency;

        var range = sheet.getRange(nextRow, 1, 1, HEADERS.length);
        range.setValues([subtotalRow]);
        range.setBackground('#E8F4FD');
        range.setFontWeight('bold');
        sheet.getRange(nextRow, 5).setNumberFormat('#,##0.00');

        grandTotals[pt.currency] = (grandTotals[pt.currency] || 0) + pt.total;
        nextRow++;
    });

    // Append grand total rows per currency
    Object.keys(grandTotals).forEach(function(currency) {
        var grandRow = new Array(HEADERS.length).fill('');
        grandRow[0] = '總計';
        grandRow[4] = grandTotals[currency];
        grandRow[5] = currency;

        var range = sheet.getRange(nextRow, 1, 1, HEADERS.length);
        range.setValues([grandRow]);
        range.setBackground('#2E75B6');
        range.setFontColor('#FFFFFF');
        range.setFontWeight('bold');
        sheet.getRange(nextRow, 5).setNumberFormat('#,##0.00');
        nextRow++;
    });
}

// ============================================================
// Google Drive Photo Upload
// ============================================================

// Returns { url, error } so callers can surface the actual reason instead of swallowing.
function uploadPhotoWithDetail(base64Data, record) {
    try {
        var rootFolder;
        try {
            rootFolder = DriveApp.getFolderById(DRIVE_FOLDER_ID);
        } catch (e1) {
            return { url: '', error: 'getFolderById(' + DRIVE_FOLDER_ID + '): ' + e1.toString() };
        }

        var projectName = record.project || '未分類';
        var projectFolder = getOrCreateSubfolder(rootFolder, projectName);

        var monthStr = record.paymentDate ? record.paymentDate.substring(0, 7) : getMonthTab();
        var monthFolder = getOrCreateSubfolder(projectFolder, monthStr);

        var imageData = base64Data;
        if (base64Data.indexOf(',') !== -1) {
            imageData = base64Data.split(',')[1];
        }

        var bytes;
        try {
            bytes = Utilities.base64Decode(imageData);
        } catch (e2) {
            return { url: '', error: 'base64Decode failed (len=' + imageData.length + '): ' + e2.toString() };
        }

        var blob = Utilities.newBlob(bytes, 'image/jpeg', buildPhotoFilename(record));

        var file;
        try {
            file = monthFolder.createFile(blob);
        } catch (e3) {
            return { url: '', error: 'createFile failed: ' + e3.toString() };
        }

        try {
            file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
        } catch (e4) {
            // File created but sharing failed — still return URL with warning
            return { url: file.getUrl(), error: 'sharing failed (file created): ' + e4.toString() };
        }

        return { url: file.getUrl(), error: null };
    } catch (err) {
        Logger.log('Photo upload failed: ' + err.toString());
        return { url: '', error: err.toString() };
    }
}

// Backwards-compatible wrapper for any callers that just want the URL
function uploadPhoto(base64Data, record) {
    var result = uploadPhotoWithDetail(base64Data, record);
    return result.url;
}

function getOrCreateSubfolder(parentFolder, folderName) {
    var folders = parentFolder.getFoldersByName(folderName);
    if (folders.hasNext()) {
        return folders.next();
    }
    return parentFolder.createFolder(folderName);
}

function buildPhotoFilename(record) {
    // Format: {date}_{project}_{amount}_{currency}.jpg
    var date = (record.paymentDate || 'unknown').replace(/-/g, '');
    var project = (record.project || 'unknown').replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '_');
    var amount = record.amount || '0';
    var currency = record.currency || 'HKD';
    return date + '_' + project + '_' + amount + '_' + currency + '.jpg';
}

// ============================================================
// Test Function (run in Apps Script editor to verify)
// ============================================================

function testDoPost() {
    var testPayload = {
        action: 'addRecord',
        record: {
            id: 'test-001',
            project: '測試項目',
            amount: 250.00,
            currency: 'HKD',
            description: '午餐工作餐',
            paymentDate: '2026-04-10',
            paymentMethod: '八達通',
            paidBy: 'Leonard',
            claimStatus: 'pending',
            claimDate: '',
            notes: '測試記錄',
            createdAt: new Date().toISOString()
        },
        photo: null
    };

    var fakeEvent = {
        postData: {
            contents: JSON.stringify(testPayload)
        }
    };

    var result = doPost(fakeEvent);
    Logger.log(result.getContent());
}
