/**
 * Turns OCR blocks (text + bounding box) back into text a language model can
 * read. OCR returns loose fragments; the layout — which row a word is on,
 * which column it sits under — is only in the coordinates. Losing it is what
 * made routine extraction fail: in a timetable the DAY of a class is known
 * only from the column it is in.
 *
 * Pure functions, no dependencies, so they can be tested against saved OCR
 * output without loading any model.
 */

export type OcrBlock = { text: string; bbox?: number[] };

type Box = {
  text: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  cx: number;
  cy: number;
};

function toBoxes(blocks: OcrBlock[]): Box[] {
  return blocks
    .filter((b) => b.text.trim())
    .map((b) => {
      const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = b.bbox ?? [];
      return { text: b.text.trim(), x1, y1, x2, y2, cx: (x1 + x2) / 2, cy: (y1 + y2) / 2 };
    });
}

/** Group boxes into visual lines: a box joins a line if its centre is inside the line's first box. */
function groupLines(boxes: Box[]): Box[][] {
  const lines: Box[][] = [];
  for (const box of [...boxes].sort((a, b) => a.cy - b.cy)) {
    const line = lines.at(-1);
    const anchor = line?.[0];
    if (line && anchor && box.cy >= anchor.y1 && box.cy <= anchor.y2) line.push(box);
    else lines.push([box]);
  }
  return lines.map((line) => line.sort((a, b) => a.x1 - b.x1));
}

function joinLines(lines: Box[][]): string {
  return lines.map((line) => line.map((b) => b.text).join(' | ')).join('\n');
}

/**
 * Faithful reading-order text: lines top to bottom, cells on one line joined
 * with " | ". This is what gets stored as `sourceText` — no corrections.
 */
export function readingOrderText(blocks: OcrBlock[]): string {
  return joinLines(groupLines(toBoxes(blocks)));
}

// ---------------------------------------------------------------------------
// Timetable grids
// ---------------------------------------------------------------------------

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/** "MONDAY", "Mon", "mon." → "MONDAY"; anything else → null. */
function dayOf(text: string): string | null {
  const t = text.toLowerCase().replace(/[^a-z]/g, '');
  if (t.length < 3) return null;
  const day = DAY_NAMES.find((d) => d === t || (d.startsWith(t) && t.length <= d.length));
  return day ? day.toUpperCase() : null;
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
}

type Cell = { col: number; boxes: Box[]; y1: number; y2: number; cy: number; text: string };

/** Text of a cell: its lines top to bottom; a line ending in "-" continues without a space. */
function cellText(boxes: Box[]): string {
  let out = '';
  for (const line of groupLines(boxes)) {
    const text = line.map((b) => b.text).join(' ');
    out = !out ? text : out.endsWith('-') ? out + text : `${out} ${text}`;
  }
  return out;
}

const TIME_TOKEN = /\d{1,2}[:.]\d{2}(?:\s*[AaPp]\.?[Mm]\.?)?/g;

/** "8:00 AM 9:20 AM" (OCR dropped the dash) → "8:00 AM - 9:20 AM". */
function formatTimeRange(text: string): string {
  const times = text.match(TIME_TOKEN);
  return times && times.length === 2 ? `${times[0]} - ${times[1]}` : text;
}

/** A timetable rebuilt from OCR: one row per time slot, one class per day cell. */
export type Timetable = {
  /** Header labels: "TIME" then the weekday columns as OCR'd ("MONDAY", ...). */
  columns: string[];
  rows: { time: string; classes: { day: number; dayName: string; text: string }[] }[];
  /** Text above the grid (titles, semester) and outside it, in reading order. */
  above: string;
  below: string;
};

/**
 * If a line of weekday names is found, rebuild the grid below it: assign every
 * block to the column whose header it sits under, merge wrapped lines into
 * cells, and attach each class cell to the time-slot row it is vertically
 * centred on. Returns null when there is no weekday header row.
 */
function parseTimetableBoxes(boxes: Box[]): Timetable | null {
  const lines = groupLines(boxes);
  const headerIdx = lines.findIndex(
    (line) => new Set(line.map((b) => dayOf(b.text)).filter(Boolean)).size >= 3,
  );
  if (headerIdx === -1) return null;

  const header = lines[headerIdx];
  const dayHeads = header.filter((b) => dayOf(b.text));
  const spacing = median(dayHeads.slice(1).map((b, i) => b.cx - dayHeads[i].cx));
  const leftHead = header.find((b) => !dayOf(b.text) && b.cx < dayHeads[0].cx);

  // Column 0 is the time column (left of the first day), then one per day.
  const colCentres = [leftHead?.cx ?? dayHeads[0].cx - spacing, ...dayHeads.map((b) => b.cx)];
  const colNames = ['TIME', ...dayHeads.map((b) => dayOf(b.text)!)];
  const columnOf = (x: number) => {
    let best = 0;
    for (let i = 1; i < colCentres.length; i++) {
      if (Math.abs(x - colCentres[i]) < Math.abs(x - colCentres[best])) best = i;
    }
    return best;
  };

  const headerBottom = Math.max(...header.map((b) => b.y2));
  const body = boxes.filter((b) => b.cy > headerBottom);
  const lineHeight = median(body.map((b) => b.y2 - b.y1));

  // Build cells per column: boxes on the same line, or starting just below
  // the previous one (a wrapped line), belong to the same cell.
  const cells: Cell[] = [];
  for (let col = 0; col < colCentres.length; col++) {
    const inCol = body.filter((b) => columnOf(b.cx) === col).sort((a, b) => a.y1 - b.y1 || a.x1 - b.x1);
    let current: Box[] = [];
    const flush = () => {
      if (!current.length) return;
      const y1 = Math.min(...current.map((b) => b.y1));
      const y2 = Math.max(...current.map((b) => b.y2));
      cells.push({ col, boxes: current, y1, y2, cy: (y1 + y2) / 2, text: fixDigitConfusions(cellText(current)) });
      current = [];
    };
    for (const box of inCol) {
      const bottom = current.length ? Math.max(...current.map((b) => b.y2)) : -Infinity;
      if (current.length && box.y1 - bottom > lineHeight * 0.6) flush();
      current.push(box);
    }
    flush();
  }

  // Rows are anchored on time cells (column 0 cells containing a digit).
  const timeCells = cells.filter((c) => c.col === 0 && /\d/.test(c.text)).sort((a, b) => a.cy - b.cy);
  if (timeCells.length === 0) return null;
  const rowPitch = median(timeCells.slice(1).map((c, i) => c.cy - timeCells[i].cy)) || lineHeight * 4;

  const rows = timeCells.map((t) => ({ time: formatTimeRange(t.text), cy: t.cy, cells: [] as Cell[] }));
  const leftovers: Cell[] = [];
  for (const cell of cells) {
    if (cell.col === 0 && timeCells.includes(cell)) continue;
    let best = rows[0];
    for (const row of rows) if (Math.abs(cell.cy - row.cy) < Math.abs(cell.cy - best.cy)) best = row;
    if (cell.col > 0 && Math.abs(cell.cy - best.cy) <= rowPitch / 2) best.cells.push(cell);
    else leftovers.push(cell);
  }

  return {
    columns: colNames,
    rows: rows.map((row) => ({
      time: row.time,
      classes: row.cells
        .sort((a, b) => a.col - b.col)
        .map((c) => ({ day: DAY_NAMES.indexOf(colNames[c.col].toLowerCase()), dayName: colNames[c.col], text: c.text })),
    })),
    above: joinLines(lines.slice(0, headerIdx)),
    below: leftovers.sort((a, b) => a.cy - b.cy).map((c) => c.text).join('\n'),
  };
}

export function parseTimetable(blocks: OcrBlock[]): Timetable | null {
  return parseTimetableBoxes(toBoxes(blocks));
}

function formatTimetable(t: Timetable): string {
  const grid = t.rows
    .map((row, i) => {
      const classes = row.classes.map((c) => `  ${c.dayName}: ${c.text}`);
      return [`Row ${i + 1} | time ${row.time}`, ...(classes.length ? classes : ['  (no classes)'])].join('\n');
    })
    .join('\n');
  return [
    t.above,
    `TIMETABLE (rebuilt from the grid: each row is a time slot; each "DAY:" line is a class in that day's column)`,
    `Columns: ${t.columns.join(' | ')}`,
    grid,
    t.below && `Text outside the grid:\n${t.below}`,
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * "8:00 AM - 9:20 AM" → { start: "08:00", end: "09:20" }. A side missing
 * AM/PM takes the other side's; if that makes start later than end, the start
 * is the morning one ("11:00 - 1:50 PM" → 11:00–13:50). Null if not a range.
 */
export function parseTimeRange(text: string): { start: string; end: string } | null {
  const tokens = [...text.matchAll(/(\d{1,2})[:.](\d{2})\s*(?:([AaPp])\.?[Mm]\.?)?/g)];
  if (tokens.length !== 2) return null;
  const [a, b] = tokens.map((m) => ({
    h: Number(m[1]),
    m: Number(m[2]),
    mer: m[3]?.toUpperCase() as 'A' | 'P' | undefined,
  }));
  if ([a, b].some((t) => t.h > 23 || t.m > 59)) return null;
  // Only an inherited AM/PM may be corrected; an explicit one is trusted.
  const startInherited = !a.mer && Boolean(b.mer);
  a.mer ??= b.mer;
  b.mer ??= a.mer;
  const to24 = (t: typeof a) =>
    !t.mer ? t.h : t.mer === 'P' ? (t.h % 12) + 12 : t.h % 12;
  let start = to24(a);
  const end = to24(b);
  if (startInherited && start * 60 + a.m >= end * 60 + b.m && a.mer === 'P') start -= 12;
  const pad = (n: number) => String(n).padStart(2, '0');
  const range = { start: `${pad(start)}:${pad(a.m)}`, end: `${pad(end)}:${pad(b.m)}` };
  return range.start < range.end ? range : null;
}

// ---------------------------------------------------------------------------
// OCR character confusions
// ---------------------------------------------------------------------------

/**
 * OCR reads 0 as O and 1 as I inside codes ("CSE26OL", "CSE32IL", "O7A").
 * Fix only unambiguous spots: a letter right after a digit, or at the start
 * of a token (or after "-") right before a digit. "ECO101" is untouched —
 * its O follows a letter.
 */
export function fixDigitConfusions(text: string): string {
  return text.replace(/\S+/g, (token) =>
    /\d/.test(token)
      ? token
          .replace(/(?<=\d)O|(?<=^|[-(/])O(?=\d)/g, '0')
          .replace(/(?<=\d)I|(?<=^|[-(/])I(?=\d)/g, '1')
      : token,
  );
}

/**
 * Text for the model: a rebuilt timetable when the image contains one,
 * otherwise reading-order text; digit confusions fixed either way.
 */
export function modelText(blocks: OcrBlock[]): string {
  const boxes = toBoxes(blocks);
  const timetable = parseTimetableBoxes(boxes);
  return fixDigitConfusions(timetable ? formatTimetable(timetable) : joinLines(groupLines(boxes)));
}
