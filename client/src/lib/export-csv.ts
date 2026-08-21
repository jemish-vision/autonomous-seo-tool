/**
 * Client-side universal CSV export helper with RFC 4180 escaping and UTF-8 BOM for Excel compatibility.
 */
export function exportToCsv<T extends Record<string, unknown>>(
  filename: string,
  rows: T[],
  columns: { key: keyof T | ((row: T) => unknown); label: string }[]
): void {
  if (rows.length === 0) return;

  const escapeCell = (val: unknown): string => {
    if (val === null || val === undefined) return "";
    const str = typeof val === "object" ? JSON.stringify(val) : String(val);
    if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const headerRow = columns.map((c) => escapeCell(c.label)).join(",");
  const dataRows = rows.map((row) =>
    columns
      .map((col) => {
        const val = typeof col.key === "function" ? col.key(row) : row[col.key];
        return escapeCell(val);
      })
      .join(",")
  );

  const csvContent = "\uFEFF" + [headerRow, ...dataRows].join("\r\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", filename.endsWith(".csv") ? filename : `${filename}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
