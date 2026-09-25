// Plain-text console formatting for the scripts' summaries.

/** Left-aligned columns separated by two spaces, with a dashed rule under the header. */
export function formatTable(header: string[], rows: string[][], indent = "  "): string {
  const widths = header.map((title, column) => Math.max(title.length, ...rows.map((row) => (row[column] ?? "").length)));
  const line = (cells: string[]) =>
    indent +
    cells
      .map((cell, column) => (column === cells.length - 1 ? cell : cell.padEnd(widths[column])))
      .join("  ")
      .trimEnd();
  return [line(header), line(widths.map((width) => "-".repeat(width))), ...rows.map(line)].join("\n");
}

/** "812 B", "334.2 KB", "7.41 MB" (1 KB = 1024 B). */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
