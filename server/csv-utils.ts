export function escapeCsvFormula(rawValue: unknown): string {
  if (rawValue === null || rawValue === undefined) {
    return '';
  }
  const str = String(rawValue);
  if (str.length === 0) {
    return '';
  }
  const trimmedStart = str.trimStart();
  if (
    str.startsWith('=') ||
    str.startsWith('+') ||
    str.startsWith('-') ||
    str.startsWith('@') ||
    str.startsWith('\t') ||
    str.startsWith('\r') ||
    trimmedStart.startsWith('=') ||
    trimmedStart.startsWith('+') ||
    trimmedStart.startsWith('-') ||
    trimmedStart.startsWith('@')
  ) {
    return `'${str}`;
  }
  return str;
}

export function serializeCsvCell(rawValue: unknown): string {
  const safe = escapeCsvFormula(rawValue);
  if (
    safe.includes('"') ||
    safe.includes(',') ||
    safe.includes('\n') ||
    safe.includes('\r')
  ) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

export function buildCsvDocument(headers: string[], rows: unknown[][]): string {
  const headerLine = headers.map((cell) => serializeCsvCell(cell)).join(',');
  const bodyLines = rows.map((row) =>
    row.map((cell) => serializeCsvCell(cell)).join(',')
  );
  return [headerLine, ...bodyLines].join('\r\n');
}

export interface CsvParseResult {
  headers: string[];
  rows: Array<{ rowNumber: number; record: Record<string, string> }>;
}

export function parseCsvText(input: string, maxRows = 500): CsvParseResult {
  const clean = input.replace(/^\uFEFF/, '');
  if (!clean.trim()) {
    throw new Error('CSV file is empty.');
  }

  const matrix: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let inQuotes = false;

  for (let i = 0; i < clean.length; i += 1) {
    const ch = clean[i];
    const next = clean[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        currentField += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        currentField += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      currentRow.push(currentField);
      currentField = '';
    } else if (ch === '\r' && next === '\n') {
      currentRow.push(currentField);
      matrix.push(currentRow);
      currentRow = [];
      currentField = '';
      i += 1;
    } else if (ch === '\n' || ch === '\r') {
      currentRow.push(currentField);
      matrix.push(currentRow);
      currentRow = [];
      currentField = '';
    } else {
      currentField += ch;
    }
  }

  if (inQuotes) {
    throw new Error('Malformed CSV: unclosed quoted field.');
  }

  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField);
    matrix.push(currentRow);
  }

  const nonEmptyRows = matrix.filter((r) => r.some((cell) => cell.trim() !== ''));
  if (nonEmptyRows.length < 2) {
    throw new Error('CSV must include a header row and at least one data row.');
  }

  const headers = nonEmptyRows[0].map((h) => h.trim());
  if (headers.some((h) => !h)) {
    throw new Error('CSV header row contains an empty column name.');
  }

  const dataRows = nonEmptyRows.slice(1);
  if (dataRows.length > maxRows) {
    throw new Error(`CSV exceeds maximum allowed row limit (${maxRows}).`);
  }

  const rows = dataRows.map((cells, idx) => {
    const record: Record<string, string> = {};
    for (let c = 0; c < headers.length; c += 1) {
      record[headers[c]] = (cells[c] ?? '').trim();
    }
    return {
      rowNumber: idx + 2,
      record,
    };
  });

  return { headers, rows };
}
