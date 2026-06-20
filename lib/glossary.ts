// Plain-language explanations of finance terms, in simple English + Roman Urdu,
// for retail PSX investors building financial literacy. Keys are lowercase slugs.
export type GlossaryEntry = { term: string; en: string; urdu: string };

export const GLOSSARY: Record<string, GlossaryEntry> = {
  pe: {
    term: "P/E ratio",
    en: "Price ÷ earnings per share. How many rupees you pay for Rs 1 of yearly profit. Lower can mean cheaper.",
    urdu: "Price taqseem EPS. Yani Rs 1 munafa ke liye aap kitne rupay de rahe hain. Kam P/E aksar sasta matlab hota hai.",
  },
  eps: {
    term: "EPS",
    en: "Earnings per share — the company's yearly profit divided by its total shares.",
    urdu: "Earnings per share — company ka saalana munafa, total shares par taqseem.",
  },
  dividendyield: {
    term: "Dividend yield",
    en: "Yearly dividend ÷ share price, as a %. The cash return you get just from dividends.",
    urdu: "Saalana dividend taqseem price, %. Sirf dividend se milne wala cash return.",
  },
  nav: {
    term: "NAV",
    en: "Net asset value — what one unit/share is really worth based on the assets behind it (used for funds and holding companies).",
    urdu: "Net asset value — ek unit/share ke peechay maujood assets ke hisaab se asli qeemat.",
  },
  xirr: {
    term: "XIRR",
    en: "Your true annualised return that accounts for when you added or withdrew money and reinvested dividends. Better than a simple % gain.",
    urdu: "Aap ka asli saalana return jo paisay dalne/nikaalne aur dividend reinvest ko bhi count karta hai. Simple % se behtar.",
  },
  cgt: {
    term: "CGT",
    en: "Capital gains tax — tax on the profit when you SELL a share for more than you paid.",
    urdu: "Capital gains tax — jab aap share faiday par bechte hain to us munafe par tax.",
  },
  wht: {
    term: "WHT",
    en: "Withholding tax — tax cut at source on your dividends (15% for filers, 30% for non-filers).",
    urdu: "Withholding tax — dividend par source par kata jane wala tax (filer 15%, non-filer 30%).",
  },
  beta: {
    term: "Beta",
    en: "How much your portfolio moves vs the market. Beta 1 = moves with KSE-100; above 1 = more volatile.",
    urdu: "Aap ka portfolio market ke muqable kitna move karta hai. Beta 1 = KSE-100 ke saath; 1 se zyada = zyada volatile.",
  },
  alpha: {
    term: "Alpha",
    en: "Return you earned ABOVE what the market's risk would explain. Positive alpha = you beat the market on a risk-adjusted basis.",
    urdu: "Wo return jo market ke risk se zyada aap ne kamaya. Positive alpha = aap ne market ko risk ke hisaab se beat kiya.",
  },
  sharpe: {
    term: "Sharpe ratio",
    en: "Return per unit of risk. Higher is better — you're getting more reward for the bumps.",
    urdu: "Har unit risk ke badle return. Zyada behtar — aap ko risk ke badle zyada inaam mil raha hai.",
  },
  drawdown: {
    term: "Max drawdown",
    en: "The biggest drop from a peak to a trough. Shows the worst pain you'd have sat through.",
    urdu: "Sab se bara giraao (peak se neeche tak). Sab se bura waqt jo aap ko sehna parta.",
  },
  marginofsafety: {
    term: "Margin of safety",
    en: "How far below fair value the price is. A bigger margin = more cushion if you're wrong.",
    urdu: "Price fair value se kitna neeche hai. Bara margin = ghalti par zyada cushion.",
  },
  payoutratio: {
    term: "Payout ratio",
    en: "Share of profit (EPS) paid out as dividend. Above 100% means they pay more than they earn — not sustainable.",
    urdu: "Munafe (EPS) ka kitna hissa dividend mein diya. 100% se zyada = kamai se zyada de rahe hain — payedaar nahi.",
  },
  bonus: {
    term: "Bonus shares",
    en: "Free extra shares the company gives instead of (or with) cash dividend. Your share count grows; price adjusts down.",
    urdu: "Cash dividend ki jagah (ya saath) muft extra shares. Aap ke shares barhte hain; price neeche adjust hoti hai.",
  },
  lookthrough: {
    term: "Look-through (NAV)",
    en: "For a holding company, the live value of all the companies it owns, added up — its real worth vs its market price.",
    urdu: "Holding company ke liye, jo companies wo rakhti hai un sab ki live qeemat jama — asli worth vs market price.",
  },
  purification: {
    term: "Purification",
    en: "The charity portion of a Shariah stock's dividend that comes from non-permissible income, which you give away to purify the return.",
    urdu: "Shariah stock ke dividend ka wo charity hissa jo non-permissible income se aata hai, jise aap sadqa kar dete hain.",
  },
};

export function glossaryEntry(key: string): GlossaryEntry | null {
  return GLOSSARY[key.toLowerCase().replace(/[^a-z]/g, "")] ?? null;
}
