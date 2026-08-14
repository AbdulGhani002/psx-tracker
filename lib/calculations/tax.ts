import type { Transaction } from "@/lib/types";
import { taxYearOf } from "@/lib/dates";

export type TaxSettings = {
  filerStatus: string; // "filer" | "non-filer"
  dividendWhtFiler: number;
  dividendWhtNonFiler: number;
  cgtRateFiler: number;
  cgtRateNonFiler: number;
};




