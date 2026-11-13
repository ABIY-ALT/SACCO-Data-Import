import type { ColumnType } from "../types";
import { headerKey, headerKeys } from "./text";

/**
 * Known SACCO field concepts. "strong" aliases are treated as a Match;
 * "weak" aliases are only ever suggested as a Possible Match for the user to confirm.
 */
export interface Concept {
  id: string;
  type: ColumnType;
  required?: boolean;
  unique?: boolean;
  money?: boolean;
  strong: string[];
  weak?: string[];
}

export const CONCEPTS: Concept[] = [
  {
    id: "member_id",
    type: "identifier",
    required: true,
    unique: true,
    strong: [
      "member id", "member number", "membership number", "membership id", "member code",
      "member ref", "member reference", "membership code", "mem id",
      "የአባል መለያ", "የአባልነት ቁጥር", "የአባል ቁጥር", "መለያ ቁጥር",
    ],
    weak: ["customer id", "client id", "customer number", "client number", "registration number", "id", "number", "code"],
  },
  {
    id: "full_name",
    type: "name",
    required: true,
    strong: [
      "full name", "member name", "name", "names", "full names", "member full name", "name of member",
      "ስም", "ሙሉ ስም", "ስም ከነአባት", "ስም ከአባት", "ስምና የአባት ስም", "የአባል ስም", "የአባሉ ስም",
    ],
    weak: ["customer name", "client name", "account name", "account holder", "account holder name"],
  },
  { id: "first_name", type: "name", strong: ["first name", "given name", "forename", "firstname"], weak: ["name"] },
  { id: "middle_name", type: "name", strong: ["middle name", "middlename"], weak: ["father name", "fathers name", "other name", "other names", "second name"] },
  { id: "last_name", type: "name", strong: ["last name", "surname", "family name", "lastname"], weak: ["grandfather name", "grand father name"] },
  { id: "gender", type: "gender", strong: ["gender"], weak: ["sex"] },
  { id: "date_of_birth", type: "date", strong: ["date of birth", "birth date", "birthdate", "birthday", "dob"], weak: ["birth"] },
  {
    id: "phone",
    type: "phone",
    strong: [
      "phone", "phone number", "mobile", "mobile number", "telephone", "telephone number", "cell",
      "cell number", "cellphone", "msisdn", "mobile phone", "phone mobile", "contact number", "mobile phone number",
    ],
    weak: ["contact", "contacts", "tel number"],
  },
  { id: "alt_phone", type: "phone", strong: ["alternative phone", "alternate phone", "other phone", "secondary phone", "phone 2", "mobile 2", "second phone"] },
  { id: "email", type: "email", strong: ["email", "email address", "e mail address"] },
  {
    id: "national_id",
    type: "identifier",
    unique: true,
    strong: [
      "national id", "national id number", "id number", "identity number", "national identity number",
      "nin", "kebele id", "fayda id", "fayda number", "passport number", "id card number",
    ],
    weak: ["id", "identification", "identification number", "id type number"],
  },
  { id: "address", type: "text", strong: ["address", "physical address", "residential address", "residence", "home address", "postal address"], weak: ["location", "city", "town"] },
  { id: "city", type: "text", strong: ["city", "town", "city town"], weak: ["location", "address"] },
  { id: "region", type: "text", strong: ["region", "state", "province"], weak: ["zone", "county"] },
  { id: "branch", type: "text", strong: ["branch", "branch name", "branch code"], weak: ["office", "station"] },
  {
    id: "join_date",
    type: "date",
    strong: [
      "date joined", "join date", "joining date", "registration date", "membership date", "date of registration",
      "date registered", "date of joining", "member since", "membership start date",
    ],
    weak: ["open date", "opening date", "account open date", "date opened", "start date", "created date", "date"],
  },
  { id: "account_number", type: "identifier", unique: true, strong: ["account number", "account id", "savings account number", "account code"], weak: ["account"] },
  {
    id: "savings_balance",
    type: "amount",
    money: true,
    strong: ["savings balance", "saving balance", "savings", "total savings", "savings amount", "deposit balance", "deposits", "savings deposit"],
    weak: ["balance", "deposit", "amount"],
  },
  {
    id: "share_capital",
    type: "amount",
    money: true,
    strong: ["share capital", "shares", "share balance", "share amount", "shares value", "share contribution", "shares amount"],
    weak: ["share", "capital"],
  },
  {
    id: "loan_amount",
    type: "amount",
    money: true,
    strong: ["loan amount", "principal", "loan principal", "disbursed amount", "amount disbursed", "loan disbursed", "principal amount", "disbursement amount"],
    weak: ["loan", "amount"],
  },
  {
    id: "loan_balance",
    type: "amount",
    money: true,
    strong: ["loan balance", "outstanding balance", "outstanding loan", "principal balance", "balance outstanding", "loan outstanding", "outstanding amount"],
    weak: ["balance", "outstanding"],
  },
  { id: "interest_rate", type: "number", strong: ["interest rate", "rate", "interest percent", "rate percent"] },
  { id: "interest_amount", type: "amount", money: true, strong: ["interest amount", "interest", "interest due", "interest charged"] },
  { id: "loan_term", type: "integer", strong: ["loan term", "term", "repayment period", "period", "tenure", "duration", "number of installments", "installments"] },
  { id: "loan_product", type: "text", strong: ["loan product", "loan type", "product", "product name", "product code"] },
  { id: "transaction_date", type: "date", strong: ["transaction date", "value date", "posting date", "payment date"], weak: ["date"] },
  { id: "transaction_amount", type: "amount", money: true, strong: ["transaction amount", "amount", "amount paid", "payment amount"], weak: ["value"] },
  { id: "debit", type: "amount", money: true, strong: ["debit", "debit amount", "dr", "withdrawal", "withdrawals"] },
  { id: "credit", type: "amount", money: true, strong: ["credit", "credit amount", "cr", "deposit amount"] },
  { id: "reference", type: "identifier", strong: ["reference", "reference number", "receipt number", "transaction id", "transaction reference", "receipt"] },
  { id: "description", type: "text", strong: ["description", "narration", "details", "particulars", "remarks", "notes", "comment", "comments"] },
  { id: "marital_status", type: "text", strong: ["marital status", "civil status", "marital", "marriage status"] },
  { id: "occupation", type: "text", strong: ["occupation", "profession", "job", "job title"], weak: ["employment"] },
  { id: "employer", type: "text", strong: ["employer", "employer name", "company", "organization", "organisation", "work place", "workplace"] },
  { id: "next_of_kin", type: "name", strong: ["next of kin", "next of kin name", "beneficiary", "nominee", "beneficiary name"] },
  { id: "next_of_kin_phone", type: "phone", strong: ["next of kin phone", "next of kin number", "next of kin contact", "beneficiary phone"] },
  { id: "status", type: "text", strong: ["status", "member status", "account status"] },
  {
    id: "monthly_contribution",
    type: "amount",
    money: true,
    strong: ["monthly contribution", "contribution", "system contribution", "monthly saving", "monthly savings", "monthly deposit"],
    weak: ["መዋጮ", "ወርሃዊ መዋጮ"],
  },
  {
    id: "registration_fee",
    type: "amount",
    money: true,
    strong: ["registration fee", "entrance fee", "membership fee", "joining fee", "መመዝገቢያ", "የመመዝገቢያ ክፍያ"],
  },
  // --- monthly transaction templates (e.g. nibsaccos "Regular transactions")
  {
    id: "regular_saving",
    type: "amount",
    money: true,
    strong: ["regular saving", "regular savings", "compulsory saving", "compulsory savings", "ቁጠባ", "መደበኛ ቁጠባ"],
    weak: ["ተቀማጭ", "saving", "deposit"],
  },
  { id: "voluntary_saving", type: "amount", money: true, strong: ["voluntary savings", "voluntary saving", "የፈቃድ ቁጠባ", "ፈቃደኛ ቁጠባ"] },
  {
    id: "loan_principal_repaid",
    type: "amount",
    money: true,
    strong: ["regular loan principal repaid", "loan principal repaid", "principal repaid", "loan repayment", "loan repaid", "principal repayment"],
    weak: ["ብድር", "የብድር ክፍያ", "ብድር ክፍያ", "የብድር መመለሻ"],
  },
  {
    id: "loan_interest_repaid",
    type: "amount",
    money: true,
    strong: ["regular loan interest repaid", "loan interest repaid", "interest repaid", "loan interest"],
    weak: ["የብድር ወለድ", "ብድር ወለድ", "ወለድ"],
  },
  {
    id: "special_loan_principal_repaid",
    type: "amount",
    money: true,
    strong: ["special loan principal repaid", "special loan repayment"],
    weak: ["ልዩ ብድር", "የልዩ ብድር ክፍያ"],
  },
  {
    id: "special_loan_interest_repaid",
    type: "amount",
    money: true,
    strong: ["special loan interest repaid", "special loan interest"],
    weak: ["የልዩ ብድር ወለድ", "ልዩ ብድር ወለድ"],
  },
  {
    id: "service_charge",
    type: "amount",
    money: true,
    strong: ["service charge", "service charge monthly", "monthly service charge", "insurance", "ኢንሹራንስ"],
    weak: ["አገልግሎት", "የአገልግሎት ክፍያ", "service"],
  },
  { id: "share_contribution", type: "amount", money: true, strong: ["እጣ", "የእጣ ክፍያ"], weak: ["አክሲዮን", "share"] },
  // recognised so they are never mistaken for data columns
  { id: "row_total", type: "amount", money: true, strong: ["በእጅ ያለ", "row total", "total amount", "amount collected", "total collected", "ጠቅላላ ክፍያ"] },
  { id: "serial_number", type: "integer", strong: ["s no", "sno", "serial", "serial number", "ተቁ", "ተራ ቁጥር"] },
];

interface AliasEntry {
  concept: Concept;
  strength: "strong" | "weak";
}

const aliasIndex = new Map<string, AliasEntry[]>();
for (const c of CONCEPTS) {
  for (const a of c.strong) addAlias(a, c, "strong");
  for (const a of c.weak ?? []) addAlias(a, c, "weak");
}
function addAlias(alias: string, concept: Concept, strength: "strong" | "weak") {
  const k = headerKey(alias);
  const list = aliasIndex.get(k) ?? [];
  list.push({ concept, strength });
  aliasIndex.set(k, list);
}

/** Concepts whose aliases match this header exactly (after normalization), including names in brackets. */
export function lookupConcepts(header: string): AliasEntry[] {
  const out: AliasEntry[] = [];
  for (const k of headerKeys(header)) for (const e of aliasIndex.get(k) ?? []) if (!out.includes(e)) out.push(e);
  return out;
}

/**
 * The concept a template header represents. A strong alias wins; otherwise a weak alias is used only when
 * it points to exactly one concept (e.g. "Sex" → gender), and is marked `weak` so its matches need confirmation.
 */
export function conceptForHeader(header: string): { concept: Concept; weak: boolean } | undefined {
  const entries = lookupConcepts(header);
  const strong = entries.find((e) => e.strength === "strong");
  if (strong) return { concept: strong.concept, weak: false };
  const weakIds = [...new Set(entries.map((e) => e.concept.id))];
  if (weakIds.length === 1) return { concept: entries[0].concept, weak: true };
  return undefined;
}

/** How a source header relates to a target concept: strong / weak alias or none. */
export function aliasStrength(conceptId: string, sourceHeader: string): "strong" | "weak" | null {
  const entries = lookupConcepts(sourceHeader).filter((e) => e.concept.id === conceptId);
  if (entries.some((e) => e.strength === "strong")) return "strong";
  if (entries.some((e) => e.strength === "weak")) return "weak";
  return null;
}

export function conceptById(id: string | undefined): Concept | undefined {
  return CONCEPTS.find((c) => c.id === id);
}

const MONEY_WORDS = ["amount", "balance", "savings", "saving", "share", "shares", "capital", "principal", "deposit", "deposits", "loan", "fee", "salary", "income", "contribution", "interest", "penalty", "charge", "dividend", "debit", "credit", "withdrawal", "payment", "repayment", "installment", "outstanding", "arrears", "value", "price", "cost", "total"];
const KEY_FINANCE_WORDS = ["loan", "savings", "saving", "share", "shares", "interest", "principal", "deposit", "fee", "penalty", "dividend", "debit", "credit", "contribution", "balance", "amount", "disbursed", "outstanding", "arrears"];

/** Guess a column type from header words when no concept is recognised. */
export function typeFromHeaderWords(tokens: string[]): ColumnType | undefined {
  const has = (...w: string[]) => w.some((x) => tokens.includes(x));
  if (has("date", "dob", "birthday")) return "date";
  if (has("phone", "mobile", "telephone", "msisdn", "cell", "cellphone")) return "phone";
  if (has("email")) return "email";
  if (has("gender", "sex")) return "gender";
  if (has("rate", "percent", "percentage")) return "number";
  if (has("term", "months", "period", "installments", "count", "age", "quantity")) return "integer";
  if (has(...MONEY_WORDS)) return "amount";
  if (has("id", "number", "code", "account", "reference", "ref", "receipt", "nin", "tin")) return "identifier";
  if (has("name", "surname", "names")) return "name";
  return undefined;
}

/**
 * For two money-like headers, returns the conflicting key words (e.g. "loan" vs "savings").
 * Used to warn the user that similar-looking financial columns may mean different things.
 */
export function financialConflict(a: string[], b: string[]): string | null {
  const ka = KEY_FINANCE_WORDS.filter((w) => a.includes(w));
  const kb = KEY_FINANCE_WORDS.filter((w) => b.includes(w));
  if (ka.length === 0 || kb.length === 0) return null;
  const onlyA = ka.filter((w) => !kb.includes(w));
  const onlyB = kb.filter((w) => !ka.includes(w));
  if (onlyA.length && onlyB.length) return `"${onlyA.join(" ")}" vs "${onlyB.join(" ")}"`;
  return null;
}
