// Shared types used by both the server (API routes) and the browser (UI).

/** A raw cell exactly as read from the uploaded file. Never modified after upload. */
export type RawCell = null | string | NumCell;

/** A numeric cell. `w` is the text Excel displays; `d` is set when the cell is formatted as a date. */
export interface NumCell {
  n: number;
  w: string;
  d?: string; // ISO date YYYY-MM-DD
}

export type FileRole = "template" | "source";

export interface SheetInfo {
  name: string;
  rowCount: number;
  colCount: number;
  month?: string; // e.g. "ሰኔ 2017 ዓ.ም ≈ June 2025", read from the title rows
}

export interface UploadedFile {
  role: FileRole;
  originalName: string;
  storedName: string;
  size: number;
  sha256: string;
  ext: "xlsx" | "xls" | "csv";
  uploadedAt: string;
  sheets: SheetInfo[];
  sheet: string; // selected sheet
  sheetChosen?: boolean; // the user picked the sheet (it is never switched automatically)
  headerRow: number; // 1-based row number of the header row
  headerRowDetected: number;
  columnCount: number;
  dataRowCount: number; // non-blank rows below the header
}

export type ColumnType =
  | "text"
  | "identifier"
  | "name"
  | "phone"
  | "email"
  | "date"
  | "gender"
  | "enum"
  | "amount"
  | "number"
  | "integer";

export const COLUMN_TYPE_LABELS: Record<ColumnType, string> = {
  text: "Text",
  identifier: "ID / Code (kept exactly)",
  name: "Person name",
  phone: "Phone number",
  email: "Email",
  date: "Date",
  gender: "Gender",
  enum: "List of allowed values",
  amount: "Money amount",
  number: "Number",
  integer: "Whole number",
};

/** A column in the SAMPLE template. The template is the source of truth for structure. */
export interface TargetColumn {
  index: number; // 0-based position in the template sheet
  letter: string;
  header: string; // exact header text as in the template (used verbatim in output)
  label: string; // cleaned header for display/matching
  concept?: string; // known SACCO field concept, if recognised
  conceptWeak?: boolean; // recognised only through a related (weak) name — matches need confirmation
  inferredType: ColumnType;
  requiredHint: boolean; // header marked with * or (required)
  dateFormatHint?: string; // e.g. DD/MM/YYYY from header or example cell
  allowedValues?: string[]; // from template dropdown list or header hint like (M/F)
  example?: string; // example value from template, if any
  exampleIsText?: boolean;
  numFmt?: string; // number format of the template example cell / column
  blankHeader: boolean;
}

/** A column in the ORIGINAL data file. */
export interface SourceColumn {
  index: number;
  letter: string;
  header: string; // header text as in file
  label: string; // display label (disambiguated if duplicate/blank)
  blankHeader: boolean;
  duplicateHeader: boolean;
  empty: boolean; // header present but no values
  nonEmptyCount: number;
  samples: string[];
  detected: DetectedKind; // what the values look like
}

export type DetectedKind =
  | "empty"
  | "date"
  | "number"
  | "phone"
  | "email"
  | "gender"
  | "text"
  | "mixed";

export type MatchStatus =
  | "exact"
  | "learned"
  | "synonym"
  | "possible"
  | "manual"
  | "missing";

export type PhoneFormat = "local" | "international" | "international_no_plus" | "keep";
export type DateOrder = "auto" | "DMY" | "MDY" | "YMD";
export type DateCalendar = "auto" | "gregorian" | "ethiopian";

export interface ColumnRule {
  type: ColumnType;
  required: boolean;
  unique: boolean;
  allowNegative: boolean;
  dateFormat: string; // output format, e.g. DD/MM/YYYY
  dateOutput: "date" | "text";
  dateOrder: DateOrder; // how to read ambiguous source dates
  /** Calendar of the dates in the original file. "auto": Ethiopian when a value says ዓ.ም or names an Ethiopian month. */
  calendar?: DateCalendar;
  phoneFormat: PhoneFormat;
  allowedValues: string[];
  valueMap: Record<string, string>; // lower-cased source value -> output value
}

export interface ColumnMapping {
  target: number; // template column index
  source: number | null; // original column index
  status: MatchStatus;
  confirmed: boolean; // false only while a "possible" match awaits the user's decision
  reason: string;
  warnings: string[];
  defaultValue: string;
  fillBlanks: boolean; // also use the default for blank cells when a source is mapped
  defaultApproved: boolean; // explicit approval for defaults in money / ID columns
  /** Fill mode: take this column's values from the template, even where the original file has a value. */
  useTemplate?: boolean;
  /** Several original columns combined into this template column ("source" is then the first of them). */
  combine?: ColumnCombine;
  rule: ColumnRule;
}

/** Join the texts of several original columns (e.g. name + father's name), or add their numbers. */
export interface ColumnCombine {
  op: "join" | "sum";
  sources: number[]; // original column indexes, in order
  separator: string; // between joined texts
}

/** Where a value of the final file comes from, chosen per cell (fill mode). */
export type ValueSource = "original" | "template";

/** Where a value of the final file actually came from. */
export type ValueFrom = "original" | "template" | "edit" | "default";

export interface TransformOptions {
  trim: boolean;
  dates: boolean;
  numbers: boolean;
  phones: boolean;
  codes: boolean; // gender + list values + value mappings
  nameCase: boolean;
  emailCase: boolean;
}

export const TRANSFORM_INFO: Record<
  keyof TransformOptions,
  { label: string; description: string }
> = {
  trim: {
    label: "Remove unnecessary spaces",
    description:
      "Removes spaces at the start and end of values. In names and text, repeated spaces inside the value become one space. IDs are only trimmed at the ends.",
  },
  dates: {
    label: "Convert dates to the template format",
    description:
      "Reads dates written in different styles (e.g. 3/4/1990, 1990-04-03, 03-Apr-1990) and writes them in the format the template expects.",
  },
  numbers: {
    label: "Convert numbers stored as text",
    description:
      'Turns text such as "1,500.00" or "ETB 2,000" into real numbers. The amount itself is never changed or rounded.',
  },
  phones: {
    label: "Standardize phone numbers",
    description:
      "Removes spaces, dashes and brackets, restores leading zeros lost by Excel, and writes all numbers in one format.",
  },
  codes: {
    label: "Standardize gender and list values",
    description:
      "Maps values like m, Male, MALE to the exact value the template expects (e.g. M), and applies your value mappings.",
  },
  nameCase: {
    label: "Standardize name capitalization",
    description:
      'Changes names to Title Case, e.g. "JOHN DOE" → "John Doe". Off by default because it can change spellings like "McDonald".',
  },
  emailCase: {
    label: "Lower-case email addresses",
    description: "Email addresses are written in lower case.",
  },
};

/**
 * "rows": every original row becomes a new row in the template.
 * "fill": the template already lists the members (e.g. a monthly transaction sheet exported by the SACCO system);
 *         original rows are matched to those members and only their amounts are filled in.
 */
export type ImportMode = "rows" | "fill";

export interface FillSettings {
  keyTarget: number; // template column holding the member ID
  nameTarget: number | null; // template column holding the member name
  sourceKeyCol: number | null; // original column with member IDs, if any
  sourceNameCol: number | null; // original column with member names
  includeAll: boolean; // final file lists every template member (members without data keep the template's values)
}

export type MemberMatchStatus =
  | "id" // same member ID
  | "exact" // same name, only one member has it
  | "remembered" // you confirmed this name before
  | "confirmed" // suggestion confirmed by you
  | "manual" // member chosen by you
  | "suggested" // likely match — needs confirmation
  | "ambiguous" // several members fit — choose one
  | "not_found" // no member in the system list
  | "skipped"; // you marked the row as not a member

export const MEMBER_STATUS_LABELS: Record<MemberMatchStatus, string> = {
  id: "Same member ID",
  exact: "Same name",
  remembered: "Remembered",
  confirmed: "Confirmed by you",
  manual: "Chosen by you",
  suggested: "Please confirm",
  ambiguous: "Several possible members",
  not_found: "Not in the member list",
  skipped: "Not imported (by you)",
};

export interface MemberCandidate {
  row: number; // template data-row index
  id: string;
  name: string;
  score: number;
}

export interface MemberMatchInfo {
  status: MemberMatchStatus;
  member: MemberCandidate | null;
  candidates: MemberCandidate[];
  reason: string;
  sourceName: string;
  sourceKey: string;
}

export interface MonthRef {
  ecMonth?: number;
  ecYear?: number;
  gcMonth: number;
  gcYear: number;
  label: string;
}

export interface ReconciliationColumn {
  source: number; // original column
  label: string;
  target: number | null; // template column it goes to (null = not imported)
  sourceTotal: number; // sum over member rows in the original file
  importedTotal: number; // sum written to the final file
}

export interface SheetTotalCheck {
  excelRow: number;
  label: string;
  ok: boolean;
  details: string[];
}

export interface Reconciliation {
  totalColumn: number | null; // original column holding each row's total (e.g. በእጅ ያለ)
  collected: number | null; // sum of that column over member rows
  imported: number; // all money written to the final file from the original file
  notImportedByColumn: number; // money in original columns that have no template column
  notImportedByRow: number; // money of rows that are not imported (not matched, errors, excluded)
  notImportedByChoice?: number; // money in cells where you chose the template's value instead
  columns: ReconciliationColumn[];
  sheetTotals: SheetTotalCheck[];
  skippedRows: { excelRow: number; kind: "total" | "header" | "empty"; text: string }[];
}

export interface ImportConfig {
  mappings: ColumnMapping[];
  transforms: TransformOptions;
  edits: Record<string, Record<string, string>>; // row index -> target index -> value typed by user
  excluded: number[]; // row indexes excluded by the user
  appliedMappingTemplateId: string | null;
  mode: ImportMode;
  fill: FillSettings | null;
  memberOverrides: Record<string, string | null>; // row index -> member ID chosen/confirmed by user (null = not a member)
  approvals: { month: boolean };
  /** Fill mode: row index -> template column index -> where the value comes from, chosen by the user for that cell. */
  cellSources?: Record<string, Record<string, ValueSource>>;
}

export type IssueLevel = "error" | "warning";

export interface Issue {
  col: number; // target index, -1 for row-level
  level: IssueLevel;
  code: string;
  message: string;
}

export type RowStatus = "ready" | "warning" | "error" | "excluded";

/** Output value after mapping + transformation. */
export type OutValue = null | string | number | { date: string };

/**
 * What happens to a value the TEMPLATE already has (fill mode: the matched member's row of the template).
 * - replaced: the template's value is replaced by data from the original file (or a correction / default value)
 * - kept:     the original file has nothing for this cell, so the template's own value stays in the final file
 * - member:   member ID / name are taken from the template's member list instead of the original file's spelling
 * - chosen:   you chose the template's value for this cell or column, so the original file's value is not used
 */
export type TemplateChange = "replaced" | "kept" | "member" | "chosen";

export const TEMPLATE_CHANGE_LABELS: Record<TemplateChange, string> = {
  replaced: "Template value replaced",
  kept: "Template value kept",
  member: "Member name / ID taken from the template",
  chosen: "Template value used (your choice)",
};

export interface TemplateChangeStat {
  key: TemplateChange;
  label: string;
  cells: number;
  columns: { target: number; count: number }[];
  samples: { row: number; target: number; template: string; original: string; after: string }[];
}

/** How the final file treats the rows and values the template already contains. */
export interface TemplateChangeSummary {
  mode: ImportMode;
  templateRows: number; // non-blank rows below the template's header row
  rowsUpdated: number; // template rows that get data from the original file (fill mode)
  rowsUnchanged: number; // template rows that are copied to the final file unchanged (fill mode, "include all members")
  rowsRemoved: number; // template rows that are not in the final file
  removedSamples: { excelRow: number; text: string }[];
  changes: TemplateChangeStat[]; // only rows that are written to the final file are counted
}

export interface ProcessedRow {
  i: number; // index into source data rows (0-based, blank rows included)
  excelRow: number; // row number in the original file
  values: OutValue[];
  display: string[];
  original: string[]; // the mapped original value per target column, as displayed in the original file
  template: string[] | null; // fill mode: the matched member's value per column as it is in the template
  templateRow: number | null; // fill mode: row number of the matched member in the template file
  fromTemplate: (TemplateChange | null)[]; // what happens to the template's value per cell, null = same value / no template row
  valueFrom: (ValueFrom | null)[]; // where each final value comes from (null = blank)
  sourceChoice: (ValueSource | null)[]; // fill mode: your choice for this cell, null = the column's setting
  changed: (string | null)[]; // transformation tag per cell, null = unchanged
  edited: boolean[];
  issues: Issue[];
  status: RowStatus;
  duplicate: boolean;
  member?: MemberMatchInfo | null; // fill mode
}

export interface TransformStat {
  key: string; // transform tag
  label: string;
  cells: number;
  columns: { target: number; count: number }[];
  samples: { row: number; target: number; before: string; after: string }[];
}

export interface IssueStat {
  code: string;
  level: IssueLevel;
  col: number;
  label: string;
  count: number;
}

export interface ProcessSummary {
  totalRows: number;
  blankRowsSkipped: number;
  ready: number; // will be included in final file (no errors, not excluded)
  clean: number; // ready and no warnings
  withWarnings: number;
  withErrors: number;
  duplicates: number;
  missingMandatory: number; // number of cells
  excluded: number;
  edited: number; // cells edited by the user
  issues: IssueStat[];
  transforms: TransformStat[];
  blocking: string[]; // reasons the final file cannot be generated yet
  approvalsNeeded: string[]; // things the user must explicitly approve
  outputRows: number; // rows in the final file
  members: Partial<Record<MemberMatchStatus, number>> | null; // fill mode
  reconciliation: Reconciliation | null;
  template?: TemplateChangeSummary | null; // missing in summaries saved by older versions
}

/** Blocking reason shown while something needs the user's approval; the Download step lets the user approve it. */
export const APPROVAL_BLOCK = "Some items need your approval before the final file can be generated (see the Download step).";

export type ImportStatus = "draft" | "mapping" | "completed" | "cancelled" | "failed";

export interface VerificationResult {
  ok: boolean;
  checkedAt: string;
  sheet: string;
  headerRow: number;
  columns: number;
  rows: number;
  checks: { label: string; ok: boolean; detail?: string }[];
}

export interface OutputFileInfo {
  kind: OutputKind;
  fileName: string;
  storedName: string;
  size: number;
  sha256: string;
  rows: number;
}

export type OutputKind = "final" | "final_csv" | "invalid" | "report" | "mapping";

export const OUTPUT_LABELS: Record<OutputKind, string> = {
  final: "Final cleaned data (Excel)",
  final_csv: "Final cleaned data (CSV)",
  invalid: "Invalid records with error descriptions",
  report: "Import validation report",
  mapping: "Column mapping report",
};

export interface ImportStats {
  totalRows: number;
  ready: number;
  withErrors: number;
  withWarnings: number;
  duplicates: number;
  missingMandatory: number;
  excluded: number;
}

export interface ImportRecord {
  id: string;
  name: string;
  status: ImportStatus;
  template: UploadedFile | null;
  source: UploadedFile | null;
  config: ImportConfig | null;
  stats: ImportStats | null;
  outputs: OutputFileInfo[];
  verification: VerificationResult | null;
  templateSignature: string | null;
  repeatOf: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  filesPurgedAt: string | null;
}

export interface AnalysisResult {
  targets: TargetColumn[];
  sources: SourceColumn[];
  templateIssues: string[];
  sourceIssues: string[];
  orderDiffers: boolean;
  extraSources: number[]; // source columns not mapped
  savedMapping: { id: string; name: string } | null;
  duplicateOf: { id: string; name: string; completedAt: string | null; status: ImportStatus }[];
  dateOrderDetected: Record<number, { order: "DMY" | "MDY" | "YMD" | null; ambiguous: boolean; evidence: string }>;
  fill: { available: boolean; keyTarget: number | null; nameTarget: number | null; members: number; duplicateIds: number };
  months: { template: MonthRef | null; source: MonthRef | null };
  sheetNote: string | null; // e.g. why a sheet was selected automatically
  sourceTotalCol: number | null;
}

/** Analysis stored with an import. */
export type StoredAnalysis = Omit<AnalysisResult, "duplicateOf"> & { savedMappingNotFound: string[] };

export interface DuplicateRef {
  id: string;
  name: string;
  completedAt: string | null;
  status: ImportStatus;
}

export interface ImportDetailResponse {
  import: ImportRecord & { analysis: StoredAnalysis | null; summary: ProcessSummary | null };
  duplicateOf: DuplicateRef[];
  mappingOptions: { id: string; name: string; timesUsed: number; lastUsedAt: string | null }[];
  notes?: string[];
}

export interface RowsResponse {
  rows: ProcessedRow[];
  total: number;
  page: number;
  pages: number;
  size: number;
}

export interface ImportEvent {
  id: string;
  action: string;
  details: Record<string, unknown> | null;
  createdAt: string;
}

export interface AppSettings {
  organizationName: string;
  retentionDays: number;
  maxUploadMb: number;
  countryCode: string;
  nationalNumberLength: number;
  phoneFormat: Exclude<PhoneFormat, "keep">;
  phoneUnique: boolean;
  dateOrder: "DMY" | "MDY";
  dateFormat: string;
  genderStyle: "M/F" | "Male/Female";
}

export const DEFAULT_SETTINGS: AppSettings = {
  organizationName: "",
  retentionDays: 30,
  maxUploadMb: 50,
  countryCode: "251",
  nationalNumberLength: 9,
  phoneFormat: "local",
  phoneUnique: true,
  dateOrder: "DMY",
  dateFormat: "DD/MM/YYYY",
  genderStyle: "M/F",
};

export interface MappingTemplate {
  id: string;
  name: string;
  templateSignature: string;
  templateHeaders: string[];
  entries: SavedMappingEntry[];
  transforms: TransformOptions;
  timesUsed: number;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
}

export interface SavedMappingEntry {
  targetHeader: string;
  sourceHeader: string | null; // normalized header of the original column
  sourceLabel: string | null;
  defaultValue: string;
  fillBlanks: boolean;
  useTemplate?: boolean;
  combine?: { op: "join" | "sum"; separator: string; sourceHeaders: string[]; sourceLabels: string[] };
  rule: ColumnRule;
}
