
import * as XLSX from 'xlsx';

export const extractNamesFromExcel = async (file: File): Promise<string[]> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        
        // Use sheet_to_json with header: 1 to get a 2D array of rows
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];
        
        if (jsonData.length === 0) {
          resolve([]);
          return;
        }

        // Find the header row by looking for specific United Pharmacies keywords
        // We look in the first 10 rows because sometimes there are empty rows or titles
        let headerRowIndex = -1;
        let nameColumnIndex = -1;
        
        const primaryKeywords = ["pharmacist name", "display name", "اسم الصيدلي"];
        const secondaryKeywords = ["اسم", "الاسم", "name", "full name"];
        const ignoreKeywords = ["row labels", "supervisor", "count of", "date", "city", "username", "email", "status"];

        for (let i = 0; i < Math.min(jsonData.length, 10); i++) {
          const row = jsonData[i];
          if (!row) continue;
          
          for (let j = 0; j < row.length; j++) {
            const cellValue = row[j]?.toString().toLowerCase().trim() || "";
            
            // Check for primary keywords first (high confidence)
            if (primaryKeywords.some(k => cellValue.includes(k))) {
              headerRowIndex = i;
              nameColumnIndex = j;
              break;
            }
          }
          if (nameColumnIndex !== -1) break;
        }

        // If no primary keywords found, look for secondary but strictly avoid ignore keywords
        if (nameColumnIndex === -1) {
          for (let i = 0; i < Math.min(jsonData.length, 10); i++) {
            const row = jsonData[i];
            if (!row) continue;
            for (let j = 0; j < row.length; j++) {
              const cellValue = row[j]?.toString().toLowerCase().trim() || "";
              if (secondaryKeywords.some(k => cellValue.includes(k)) && 
                  !ignoreKeywords.some(k => cellValue.includes(k))) {
                headerRowIndex = i;
                nameColumnIndex = j;
                break;
              }
            }
            if (nameColumnIndex !== -1) break;
          }
        }

        // Final Fallback: Score columns based on name-like properties
        if (nameColumnIndex === -1) {
          const columnScores = new Array(jsonData[0]?.length || 0).fill(0);
          const sampleStart = headerRowIndex === -1 ? 0 : headerRowIndex + 1;
          const sampleRows = jsonData.slice(sampleStart, sampleStart + 20);
          
          sampleRows.forEach(row => {
            row.forEach((cell, idx) => {
              const val = cell?.toString().trim() || "";
              const headerVal = jsonData[headerRowIndex]?.[idx]?.toString().toLowerCase() || "";
              
              // Skip columns that definitely look like non-names or are pivot labels
              if (ignoreKeywords.some(k => headerVal.includes(k))) return;
              
              // Name score: reasonable length, multiple words, no symbols
              if (val.length > 8 && val.split(' ').length >= 2 && !val.includes("@") && isNaN(Number(val))) {
                columnScores[idx] += 2;
              } else if (val.length > 5 && isNaN(Number(val))) {
                columnScores[idx] += 1;
              }
            });
          });
          
          nameColumnIndex = columnScores.indexOf(Math.max(...columnScores));
        }

        if (nameColumnIndex === -1) {
          console.warn("Could not reliably identify a name column. Defaulting to column 0.");
          nameColumnIndex = 0;
        }

        const names: string[] = [];
        const startRow = headerRowIndex === -1 ? 0 : headerRowIndex + 1;
        
        for (let i = startRow; i < jsonData.length; i++) {
          const row = jsonData[i];
          if (!row) continue;
          
          const nameVal = row[nameColumnIndex]?.toString().trim();
          const headerVal = jsonData[headerRowIndex]?.[nameColumnIndex]?.toString().toLowerCase() || "";
          
          // Double check we are not in the Pivot area by checking if column G-like index has "Row Labels"
          // In United Pharmacies sheet, Column G (index 6) is usually the Pivot
          if (nameColumnIndex >= 6 && headerVal.includes("row labels")) continue;

          // Filter out header re-entries, summary rows, or empty entries
          if (nameVal && nameVal.length > 3 && isNaN(Number(nameVal))) {
            // Avoid adding titles of supervisors if possible (usually starting with Dr. or Dr)
            // but in the "Pharmacist name" column there might be Dr. too, so we trust the column detection
            names.push(nameVal);
          }
        }
        
        const uniqueNames = Array.from(new Set(names));
        resolve(uniqueNames);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
};
