import { detectGovernedNavigationTarget } from "./governed-navigation.js";
import { classifyV3ConversationalTurn } from "./conversation.js";
import { financialEducationRouteReason } from "./financial-education-query.js";
import { reviewOrderPreviewIntent } from "./order-intent.js";
import { analyzeV3SemanticFrame } from "./semantic-frame.js";

export const V3_MVP_FUNCTIONS = [
  "current_portfolio_value",
  "ytd_gain_loss_twr",
  "holding_average_cost",
  "sector_allocation",
  "one_month_mover_contribution",
  "etf_explanation_risk",
  "fees_tariff",
  "order_ticket_preview",
] as const;

export type V3MvpFunction = (typeof V3_MVP_FUNCTIONS)[number];

export const V3_ADDITIONAL_CAPABILITIES = [
  "recent_trading_activity",
  "purchase_history",
  "largest_holding",
  "market_quote",
  "market_history",
  "market_event",
  "company_research",
  "technical_analysis",
  "news_sentiment",
  "market_move_explanation",
  "security_risk",
  "security_decision_support",
  "portfolio_allocation_analysis",
  "hypothetical_portfolio_analysis",
  "hypothetical_position_analysis",
  "approved_knowledge",
  "education",
  "conversation",
] as const;

export type V3AdditionalCapability =
  (typeof V3_ADDITIONAL_CAPABILITIES)[number];
export type V3Function = V3MvpFunction | V3AdditionalCapability;
export type V3Locale = "az-AZ" | "en-US";
export type V3MarketHistoryRange =
  | "1d"
  | "1w"
  | "1m"
  | "6m"
  | "1y"
  | "5y"
  | "10y"
  | "max";
export const V3_RESEARCH_FACETS = [
  "listing",
  "market_cap",
  "pe",
  "dividend",
  "price_range",
  "analyst_consensus",
  "risk_comparison",
  "general",
] as const;
export type ResearchFacet = (typeof V3_RESEARCH_FACETS)[number];
export type V3ResearchFacet = ResearchFacet;
export type V3Boundary =
  | "order_execution"
  | "sensitive_support"
  | "prompt_injection";
export type V3RouteKind = "mvp" | "capability" | "boundary" | "clarify";

export interface V3RouteDecision {
  readonly kind: V3RouteKind;
  /** The deterministic route selected by the control plane. */
  readonly route: V3Function | null;
  /** Populated only when `kind` is `mvp`. */
  readonly mvpFunction: V3MvpFunction | null;
  /**
   * A control-plane-selected research projection. The raw customer prompt is
   * never passed to a writer to decide which financial fields to disclose.
   */
  readonly researchFacet: V3ResearchFacet | null;
  /** Populated only when `kind` is `boundary`. */
  readonly boundary: V3Boundary | null;
  readonly locale: V3Locale;
  readonly symbols: readonly string[];
  readonly confidence: number;
  readonly reasonCodes: readonly string[];
  readonly requiresPortfolio: boolean;
  readonly requiresMarketData: boolean;
  readonly requiresKnowledge: boolean;
  readonly readOnly: boolean;
}

export interface V3RouteOptions {
  readonly locale?: V3Locale | "az" | "en";
}

export interface V3KnownCapabilityRouteInput {
  /** Selected by trusted server code, never copied from a request field. */
  readonly route: V3Function;
  readonly locale: V3Locale;
  readonly symbols?: readonly string[];
  /** Selected or derived by trusted server code, never accepted from model text. */
  readonly researchFacet?: V3ResearchFacet | null;
  readonly reasonCode: string;
}

export const V3_CONVERSATION_CONTEXT_ROUTES = [
  "holding_average_cost",
  "market_quote",
  "market_history",
  "market_event",
  "company_research",
  "technical_analysis",
  "news_sentiment",
  "market_move_explanation",
  "security_risk",
  "security_decision_support",
  "etf_explanation_risk"
] as const satisfies readonly V3Function[];

export type V3ConversationContextRoute =
  (typeof V3_CONVERSATION_CONTEXT_ROUTES)[number];

const V3_CONVERSATION_CONTEXT_ROUTE_SET = new Set<V3Function>(
  V3_CONVERSATION_CONTEXT_ROUTES
);

const RESERVED_NON_SYMBOL_TERMS = new Set([
  "P",
  "S",
  "SP",
  "L",
  "PL",
  "PNL",
  "YTD",
  "TWR",
  "TTM",
  "ETF",
  "ETFS",
  "PERCENT",
  "USD",
  "AZN",
  "EUR",
  "GBP",
  "RSI",
  "MACD",
  "SMA",
  "EMA",
  "EPS",
  "PE",
  "ROE",
  "ADR",
  "NEWS",
  "RISK",
  "PRICE",
  "BUY",
  "SELL",
  "ABB",
  "FIN",
  "OTP",
  "PIN",
  "ID",
  "SEC",
]);

const COMMON_NON_SYMBOL_WORDS = new Set([
  "A",
  "AN",
  "AND",
  "ARE",
  "AS",
  "AT",
  "BE",
  "BY",
  "CAN",
  "CURRENT",
  "DO",
  "FOR",
  "FROM",
  "HOW",
  "I",
  "IN",
  "IS",
  "IT",
  "ME",
  "MY",
  "OF",
  "ON",
  "OR",
  "SHOW",
  "THE",
  "THIS",
  "TO",
  "WHAT",
  "WITH",
  "YOU",
]);

const COMPANY_ALIASES: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bagilent(?:\s+technologies(?:,\s*inc\.?)?)?\b/iu, "A"],
  [/\b(?:apple|apple\s+inc)\b/iu, "AAPL"],
  [/\b(?:nvidia|nvidia\s+corporation)\b/iu, "NVDA"],
  [/\b(?:intel|intel\s+corporation)\b/iu, "INTC"],
  [/\b(?:microsoft|microsoft\s+corporation)\b/iu, "MSFT"],
  [/\b(?:tesla|tesla\s+inc)\b/iu, "TSLA"],
  [/\b(?:amazon|amazon\.com)\b/iu, "AMZN"],
  [/\b(?:alphabet|google)\b/iu, "GOOGL"],
  [/\b(?:meta|meta\s+platforms)\b/iu, "META"],
];

const KNOWN_LOWERCASE_SYMBOLS = new Set([
  "aapl",
  "amzn",
  "bnd",
  "googl",
  "intc",
  "meta",
  "msft",
  "nvda",
  "qqq",
  "spy",
  "tsla",
  "voo",
]);

const AZERBAIJANI_SIGNAL =
  /[əğıöşüç]|\b(?:mənim|mene|mənə|nədir|nedir|nece|neçə|neceye|niye|neye\s+gore|bu\s+gun|asagi|dus\p{L}*|arasinda|esas\s+ferq|hansi|uygun|ayliq|illik|yox|cari|dəyər|deyer|gəlir|gelir|zərər|zerer|qiymət|qiymet|xəbər|xeber|riskini|səhm|sehm|alış|alis|satış|satis|ticaret|komissiya|tarif|sektor|bölgü|bolgu|töhfə|tohfe|nagd|vesait|balansim|qeder|sag\s+ol|komek|sade|qisa|izah)\b|(?<!\p{L})portfel\p{L}*(?!\p{L})/iu;

const PORTFOLIO =
  /(?<!\p{L})(?:portfolio|porfolio|portolio|portoflio|portfel\p{L}*)(?!\p{L})/iu;
const PORTFOLIO_VALUATION_PHRASE =
  /\b(?:(?:(?:my|the|this)\s+)?portfolio\s+(?:(?:current(?:ly)?|total)\s+)?(?:value|worth|balance|valuation)|(?:value|worth|balance|valuation)\s+(?:of|for)\s+(?:(?:my|the|this)\s+)?portfolio)\b|(?<!\p{L})portfel\p{L}*[\s\S]{0,32}(?:(?:cari|[uü]mumi)\s+)?(?:d[əe]y[əe]r\p{L}*|balans(?!la[şs])\p{L}*)(?!\p{L})/iu;
const CASH_BALANCE =
  /\b(?:how\s+much\s+(?:available\s+)?cash\s+(?:do\s+i\s+have|is\s+in\s+my\s+(?:account|portfolio))|what(?:'s|\s+is)\s+my\s+(?:available\s+)?cash(?:\s+balance)?|show\s+(?:me\s+)?my\s+(?:available\s+)?cash(?:\s+balance)?|my\s+cash\s+balance)\b|(?<!\p{L})(?:n[əe]\s+q[əe]d[əe]r\s+na[ğg]d\s+(?:v[əe]sait(?:im)?|pul(?:um)?)\s+var|na[ğg]d\s+(?:balans[ıi]m|v[əe]saitim|pulum)\s+n[əe]\s+q[əe]d[əe]rdir|(?:hesab|portfel)(?:[ıi]m)?d[əe]\s+n[əe]\s+q[əe]d[əe]r\s+na[ğg]d\s+(?:v[əe]sait|pul)\s+var)(?!\p{L})/iu;
const CURRENT_VALUE =
  /\b(?:current\s+(?:portfolio\s+)?value|total\s+(?:portfolio\s+)?value|value\s+of\s+(?:my\s+)?portfolio|portfolio\s+worth|net\s+liquidation|cari\s+d[əe]y[əe]r\p{L}*|[uü]mumi\s+d[əe]y[əe]r\p{L}*|portfel\p{L}*\s+(?:d[əe]y[əe]r\p{L}*|ne[cç][əe]dir|balans(?!la[şs])\p{L}*))\b/iu;
const AZN_TARGET =
  /\bAZN\b|\b(?:azerbaijani\s+)?manat\b|(?<!\p{L})manat(?:a|la|d[ıi]r)?(?!\p{L})/iu;
const PORTFOLIO_VALUE_CONVERSION_FOLLOW_UP =
  /^(?:please\s+)?(?:convert|show|give)(?:\s+(?:it|that|the\s+(?:value|amount)))?\s+(?:in|into|to)\s+(?:AZN|(?:azerbaijani\s+)?manat)[?.!]*$|^(?:onu|bunu|d[əe]y[əe]ri|m[əe]bl[əe][ğg]i)?\s*(?:AZN|manat)(?:-[əe]|\s+il[əe])?\s+[cç]evir[?.!]*$/iu;
const PERFORMANCE =
  /(?:\bYTD\b|\bTWR\b|P\s*(?:&|\/|and)\s*L|\bP\s*NL\b|\bprofit\b|\bloss\b|\bgain\b|\bmade\b|\bgained\b|\blost\b|\breturn\p{L}*\b|\bperformance\b|\bg[əe]lir\p{L}*\b|\bz[əe]r[əe]r\p{L}*\b|\bqazanc\p{L}*\b|\bg[əe]lirlilik\p{L}*\b)/iu;
const NATURAL_PERFORMANCE_RESULT =
  /\bdoing\b|\bresult\p{L}*\b|(?<!\p{L})(?:n[əe]tic[əe]\p{L}*|g[oö]st[əe]rici\p{L}*)(?!\p{L})/iu;
const YEAR_TO_DATE =
  /\b(?:YTD|year[- ]to[- ]date|this\s+year|so\s+far\s+this\s+year)\b|(?<!\p{L})(?:bu\s+il|[iİıI]lin\s+[əe]vv[əe]lind[əe]n)(?!\p{L})/iu;
const PERSONAL_INVESTMENT_PERFORMANCE =
  /\b(?:my\s+(?:portfolio|investments?)|on\s+my\s+investments?|have\s+i\s+(?:made|gained|lost)|did\s+i\s+(?:make|gain|lose))\b|(?<!\p{L})investisiya\p{L}*(?!\p{L})/iu;
const AVERAGE_COST =
  /\b(?:average\s+(?:purchase\s+)?(?:cost|price)|cost\s+basis|avg\.?\s+(?:cost|price))\b|(?<!\p{L})(?:orta(?:lama)?\s+(?:maya\s+)?d[əe]y[əe]r\p{L}*|orta(?:lama)?\s+(?:al[ıi][şs]\s+)?qiym[əe]t\p{L}*|orta\s+hesabla[\s\S]{0,48}qiym[əe]t\p{L}*|maya\s+d[əe]y[əe]r\p{L}*)(?!\p{L})/iu;
const HISTORICAL_AVERAGE_COST =
  /\b(?:did\s+i\s+(?:buy|purchase)|have\s+i\s+(?:bought|purchased))\b|(?<!\p{L})(?:alm[ıi][şs]am|almi[şs]am)(?!\p{L})/iu;
const PURCHASE_HISTORY =
  /\b(?:(?:my\s+)?(?:purchase|buying)\s+(?:history|records?)|(?:show|list)\s+(?:me\s+)?(?:my\s+)?(?:recent\s+|latest\s+)?purchases?|when\s+did\s+i\s+(?:buy|purchase))\b|(?<!\p{L})(?:(?:al[ıi][şs]|ald[ıi][ğg][ıi]m\s+s[əe]hm)\s+tarix[cç][əe]\p{L}*|son\s+al[ıi][şs]lar[ıi]m\p{L}*|al[ıi][şs]lar[ıi]m[ıi]\s+g[oö]st[əe]r\p{L}*)(?!\p{L})/iu;
const RECENT_TRADING_ACTIVITY =
  /\b(?:(?:recent|latest|last)(?:\s+(?:10|ten))?\s+(?:(?:trading|stock)\s+)?(?:activity|trades?|transactions?|orders?)|(?:show|list)\s+(?:me\s+)?(?:my\s+)?(?:trades?|transactions?|orders?)|(?:portfolio|account)\s+(?:trades?|transactions?|orders?|activity))\b|(?<!\p{L})(?:son(?:uncu)?(?:\s+(?:10|on))?\s+(?:ticar[əe]t\s+)?(?:[əe]m[əe]liyyat\p{L}*|sifari[şs]\p{L}*)|(?:[əe]m[əe]liyyat|sifari[şs])\p{L}*\s+tarix[cç][əe]\p{L}*|(?:[əe]m[əe]liyyatlar[ıi]m[ıi]|sifari[şs]l[əe]rimi)\s+g[oö]st[əe]r\p{L}*)(?!\p{L})/iu;
const SECTOR_ALLOCATION =
  /\b(?:sector\s+(?:allocation|breakdown|exposure|weights?)|allocation\s+by\s+sector|sektor\p{L}*\s+(?:b[oö]lg[uü]\p{L}*|paylan\p{L}*|ekspozisiya\p{L}*|[cç][əe]ki\p{L}*))\b|\b(?:what\s+percent(?:age)?|how\s+much|how\s+many\s+percent)[\s\S]{0,80}\b(?:portfolio|porfolio|portolio|portoflio)\b[\s\S]{0,80}\bsector\b|\b(?:what\s+percent(?:age)?|how\s+much)[\s\S]{0,80}\b(?:portfolio|porfolio|portolio|portoflio)\b[\s\S]{0,80}\b(?:technology|tech|financials?|healthcare|energy|industrials?|utilities|consumer|materials?|real\s+estate|communications?)\b|\b(?:portfolio|porfolio|portolio|portoflio)\b[\s\S]{0,80}\b(?:percentage|percent)\b[\s\S]{0,80}\bsector\b|(?<!\p{L})portfel\p{L}*[\s\S]{0,80}(?:ne[cç][əe]\s+faizi|n[əe]\s+q[əe]d[əe]ri|faiz\p{L}*)[\s\S]{0,80}sektor\p{L}*(?!\p{L})|(?<!\p{L})sektor\p{L}*[\s\S]{0,80}portfel\p{L}*[\s\S]{0,80}(?:[cç][əe]ki\p{L}*|faiz\p{L}*)(?!\p{L})|\bportfolio\b[\s\S]{0,80}(?:ne[cç][əe]\s+faizi|faiz\p{L}*)[\s\S]{0,80}(?:sector|sektor)\p{L}*/iu;
const MONTHLY_MOVER =
  /(?:\b(?:one|1)\s*-?\s*month\b|\blast\s+month\b|\bmonthly\b|\b1M\b|(?<!\p{L})(?:bir|1)\s+ay\p{L}*(?!\p{L})|(?<!\p{L})son\s+(?:(?:bir|1)\s+)?ay\p{L}*(?!\p{L}))[\s\S]{0,80}(?<!\p{L})(?:mover\p{L}*|chang\p{L}*|contribut\p{L}*|driver\p{L}*|impact\p{L}*|t[oö]hf[əe]\p{L}*|t[əe]sir\p{L}*|d[əe]yi[şs]\p{L}*|qazand[ıi]r\p{L}*|art[ıi]r\p{L}*|azal\p{L}*)(?!\p{L})|(?<!\p{L})(?:mover\p{L}*|chang\p{L}*|contribut\p{L}*|driver\p{L}*|impact\p{L}*|t[oö]hf[əe]\p{L}*|t[əe]sir\p{L}*|d[əe]yi[şs]\p{L}*|qazand[ıi]r\p{L}*)(?!\p{L})[\s\S]{0,80}(?:\b(?:one|1)\s*-?\s*month\b|\blast\s+month\b|\b1M\b|(?<!\p{L})(?:bir|1)\s+ay\p{L}*(?!\p{L})|(?<!\p{L})son\s+(?:(?:bir|1)\s+)?ay\p{L}*(?!\p{L}))/iu;
const ETF_TERM = /\bETF(?:s)?\b/iu;
const LARGEST_HOLDING =
  /\b(?:largest|biggest|top)\s+(?:holding|position|investment)\b|\b(?:which|what)\s+(?:holding|position)\s+is\s+(?:largest|biggest)\b|(?<!\p{L})(?:ən|en)\s+b[öo]y[üu]k\s+(?:mövqe|movqe|aktiv|investisiya)|(?:ən|en)\s+[cç]ox\s+pay[ıi]\s+olan\s+(?:mövqe|s[əe]hm)(?!\p{L})/iu;
const ACTIVITY_DATE_RANGE_REQUEST =
  /(?:\b(?:trades?|transactions?|orders?|purchases?|account\s+activity|trading\s+activity)\b|(?<!\p{L})(?:[əe]m[əe]liyyat|sifari[şs]|al[ıi][şs])\p{L}*(?!\p{L}))[\s\S]{0,100}(?:\b(?:from|between)\s+(?:\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|[A-Za-z]+\s+\d{1,2})\b|(?<!\p{L})(?:tarixind[əe]n|tarixl[əe]ri\s+aras[ıi]nda|iyun|yanvar|fevral|mart|aprel|may|iyul|avqust|sentyabr|oktyabr|noyabr|dekabr)(?!\p{L}))/iu;
const ACCOUNT_FEE_OR_DIVIDEND_ACTIVITY =
  /\b(?:my|account|portfolio|recent|latest)\b[\s\S]{0,60}\b(?:fees?|commissions?|dividends?)\b|\b(?:fees?|commissions?|dividends?)\b[\s\S]{0,60}\b(?:charged|paid|received)\b[\s\S]{0,40}\b(?:me|my|account|portfolio)\b|(?<!\p{L})(?:hesab|portfel|son)\p{L}*[\s\S]{0,60}(?:komissiya|dividend)\p{L}*(?!\p{L})/iu;
const MARKET_HISTORY_REQUEST =
  /\b(?:price\s+)?(?:chart|history|performance|historical\s+(?:price|prices|performance)|performance\s+(?:over|for)|return\s+(?:over|for)|past\s+(?:day|week|month|year)|last\s+(?:day|week|month|year))\b|(?<!\p{L})(?:qiym[əe]t\s+)?(?:qrafik\p{L}*|tarix[cç][əe]\p{L}*|performans\p{L}*|ke[cç]mi[şs]\s+performans\p{L}*|son\s+(?:g[uü]n|h[əe]ft[əe]|ay|il)\s+(?:performans|g[əe]lir\p{L}*))(?!\p{L})/iu;
const CUSTOM_MARKET_DATE_RANGE =
  /\b(?:from|between)\s+\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\s+(?:to|and)\s+\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\b|(?<!\p{L})\d{4}[-/.]\d{1,2}[-/.]\d{1,2}(?:-d[əe]n)?\s+\d{4}[-/.]\d{1,2}[-/.]\d{1,2}(?:-d[əe]k)?(?!\p{L})/iu;

export function detectV3MarketHistoryRange(
  message: string
): V3MarketHistoryRange {
  const normalized = message.normalize("NFKC").toLocaleLowerCase("en-US");
  if (/\b(?:max|all[ -]?time|maximum)\b|(?:bütün\s+dövr|butun\s+dovr|hamısı|hamisi)/u.test(normalized)) return "max";
  if (/\b(?:10\s*(?:y|yr|yrs|years?)|ten\s+years?)\b|10\s*il/u.test(normalized)) return "10y";
  if (/\b(?:5\s*(?:y|yr|yrs|years?)|five\s+years?)\b|5\s*il/u.test(normalized)) return "5y";
  if (/\b(?:6\s*(?:m|mo|mos|months?)|six\s+months?)\b|6\s*ay/u.test(normalized)) return "6m";
  if (/\b(?:1\s*(?:y|yr|year)|one[-\s]+year|yearly|last\s+year|past\s+year)\b|(?:1\s*il|illik|son\s+il)/u.test(normalized)) return "1y";
  if (/\b(?:1\s*(?:m|mo|month)|one[-\s]+month|monthly|last\s+month|past\s+month)\b|(?:1\s*ay|aylıq|ayliq|son\s+ay)/u.test(normalized)) return "1m";
  if (/\b(?:1\s*(?:w|wk|week)|one[-\s]+week|weekly|last\s+week|past\s+week)\b|(?:1\s*həftə|1\s*hefte|həftəlik|heftelik|son\s+həftə|son\s+hefte)/u.test(normalized)) return "1w";
  if (/\b(?:1\s*(?:d|day)|one[-\s]+day|today|daily|last\s+day|past\s+day)\b|(?:1\s*gün|1\s*gun|bu\s+gün|bu\s+gun|günlük|gunluk|son\s+gün|son\s+gun)/u.test(normalized)) return "1d";
  return "1y";
}

/** Returns a supported display currency only when it is explicit in the turn. */
export function detectV3RequestedCurrency(message: string): "AZN" | null {
  return AZN_TARGET.test(message.normalize("NFKC")) ? "AZN" : null;
}

export function marketHistoryRangeFromRoute(
  route: Pick<V3RouteDecision, "route" | "reasonCodes">
): V3MarketHistoryRange | null {
  if (route.route !== "market_history") return null;
  const encoded = route.reasonCodes.find((code) =>
    code.startsWith("market_history_range:")
  )?.slice("market_history_range:".length);
  return ([
    "1d", "1w", "1m", "6m", "1y", "5y", "10y", "max"
  ] as readonly string[]).includes(encoded ?? "")
    ? encoded as V3MarketHistoryRange
    : null;
}
const EXPLAIN_OR_RISK =
  /\b(?:explain\p{L}*|what\s+is|how\s+(?:does|do)|risk\p{L}*|overview|n[əe]dir|izah\p{L}*|risk\p{L}*|nec[əe]\s+i[şs]l[əe]yir)\b/iu;
const FEES =
  /\b(?:fees?|tariffs?|pricing|commis{1,2}ions?|charges?|service\s+fee|komissiya\p{L}*|tarif\p{L}*|xidm[əe]t\s+haqq\p{L}*|haqq\p{L}*)\b/iu;
const PREVIEW =
  /\b(?:preview|read[- ]?only|simulate|simulation|estimate|draft|what\s+would|how\s+much\s+would|onbaxis\p{L}*|simulyasiya|hesabla\p{L}*|təxmini|texmini|ne[cç][əe]y[əe]\s+ba[şs]a\s+g[əe]l)\b|(?<!\p{L})(?:önbaxış\p{L}*|yaln[ıi]z\s+bax[ıi][şs]|bax[ıi][şs]\s+[uü][cç][uü]n)(?!\p{L})/iu;
const OPEN_TICKET =
  /\bopen\b[\s\S]{0,80}\b(?:buy|sell)\s+(?:order\s+)?ti(?:cket|kcet)\b|(?<!\p{L})(?:al[ıi][şs]|sat[ıi][şs])\s+bilet\p{L}*\s+a[cç]\p{L}*(?!\p{L})/iu;
const ORDER_LANGUAGE =
  /\b(?:buy|sell|purchase|order|ticket|shares?|stock|al(?:maq|ış|is)?|sat(?:maq|ış|is)?|sifari[şs]|s[əe]hm)\b/iu;
const EXECUTE_ORDER =
  /\b(?:buy|sell|purchase|place|execute|submit)\b[\s\S]{0,60}\b(?:share|stock|order|ticket|\$?[A-Za-z]{1,5})\b|(?<!\p{L})(?:al|sat|yerl[əe][şs]dir\p{L}*|icra\s+et|investisiya\s+et)(?!\p{L})[\s\S]{0,60}(?<!\p{L})(?:s[əe]hm\p{L}*|sifari[şs]\p{L}*|\$?[A-Za-z]{1,5})(?!\p{L})/iu;
const IMPERATIVE_EXECUTE_ORDER =
  /^(?:please\s+)?(?:buy|sell|purchase|place|execute|submit)\b|(?<!\p{L})(?:xahi[şs]\s+edir[əe]m\s+)?(?:al|sat|yerl[əe][şs]dir|icra\s+et)(?!\p{L})/iu;
const POLITE_OR_INDIRECT_EXECUTE_ORDER =
  /\b(?:can|could|would|will)\s+you\s+(?:please\s+)?(?:buy|sell|purchase|place|execute|submit)\b|\b(?:i\s+(?:want|need)(?:\s+you)?\s+to|i(?:'d|\s+would)\s+like(?:\s+you)?\s+to|go\s+ahead\s+and)\s+(?:buy|sell|purchase|place|execute|submit)\b|(?<!\p{L})(?:(?:ala|sata)\s+bil[əe]rs[əe]n(?:iz)?|(?:al|sat)arsan(?:[ıi]z)?|(?:almaq|satmaq)\s+(?:ist[əe]yir[əe]m|ist[əe]rdim)|m[əe]nim\s+[uü][cç][uü]n[\s\S]{0,40}(?:al|sat)|xahi[şs]\s+edir[əe]m[\s\S]{0,40}(?:al|sat))(?!\p{L})/iu;
const PREVIEW_THEN_EXECUTE_ORDER =
  /(?:\b(?:and\s+)?then\b|(?<!\p{L})sonra(?!\p{L}))[\s\S]{0,40}(?:\b(?:buy|sell|purchase|place|execute|submit)\b|(?<!\p{L})(?:al|sat|yerl[əe][şs]dir|icra\s+et)(?!\p{L}))/iu;
const QUOTE =
  /\b(?:current|latest|live|real[- ]?time|today(?:'s)?)\s+(?:stock\s+)?price\b|\b(?:stock\s+)?price\s+(?:of|for)\b|\b(?:what(?:'s|\s+is)|how\s+much\s+is)\b[^.!?\n]{0,60}\b(?:trading|quoted)\s+at\b|\bne[cç][əe]dir\b[\s\S]{0,25}\b(?:qiym[əe]t|s[əe]hm)\b|\b(?:cari|son|indiki|haz[ıi]rk[ıi]|bug[uü]nk[uü])\s+(?:s[əe]hm\s+)?qiym[əe]t\p{L}*\b|(?<!\p{L})(?:(?:indi|haz[ıi]rda)\s+)?ne[cç][əe]y[əe]\s+ticar[əe]t\s+olunur(?!\p{L})/iu;
const TECHNICAL =
  /\b(?:technical\s+analysis|indicators?|chart\s+analysis|RSI|MACD|moving\s+average|support\s+(?:and|&)\s+resistance|texniki\s+analiz|indikator\p{L}*|qrafik\s+analiz)\b/iu;
const NEWS_SENTIMENT =
  /\b(?:news|headlines?|sentiment|press\s+coverage|market\s+mood|x[əe]b[əe]r\p{L}*|sentiment\p{L}*|bazar\s+[əe]hval\p{L}*)\b/iu;
const SECURITY_RISK =
  /(?<!\p{L})(?:risk\s+analysis|risky|downside|volatility|drawdown|risk\p{L}*|riskini|riskl[əe]r\p{L}*|volatillik|enim\s+riski)(?!\p{L})/iu;
const COMPANY_RESEARCH =
  /\b(?:analy[sz]e|analysis|anaylsis|analyse|research|fundamentals?|valuation|financials?|earnings|company\s+overview|təhlil|tehlil|analiz|fundamental\p{L}*|şirkət\p{L}*\s+haqqında|sirket\p{L}*\s+haqqinda)\b/iu;
const COMPANY_RESEARCH_FACT =
  /\b(?:market\s*cap(?:italization)?|p\s*\/?\s*e|price[\s-]*to[\s-]*earnings|trailing\s+p\/?e|forward\s+p\/?e|TTM|dividend(?:\s+(?:yield|payment|history))?|(?:last|latest)\s+dividend|52[\s-]*week|analyst(?:\s+(?:rating|consensus|target))?|listed|listing|which\s+exchange|exchange\s+listed|yield\s+to\s+maturity|distribution\s+yield)\b|(?<!\p{L})(?:bazar\s+kapitallaş\p{L}*|P\/E|dividend\s+(?:gəlirliliyi|ödənişi|tarixi)|52\s+həftəlik|analitik\s+(?:reytinqi|konsensusu|hədəfi)|hansı\s+birja|birjada\s+siyahı)\p{L}*(?!\p{L})/iu;
const DECISION_FACTORS =
  /\b(?:should\s+i\s+invest|worth\s+investing|bull\s+case|bear\s+case|pros\s+and\s+cons|decision\s+factors?|what\s+else\s+can\s+you\s+tell|investisiya\s+etm[əe]y[əe]\s+d[əe]y[əe]r|m[uü]sb[əe]t\s+v[əe]\s+m[əe]nfi\s+t[əe]r[əe]fl[əe]r)\b/iu;
const PERSONAL_SECURITY_DECISION =
  /\bshould\s+i\s+(?:buy|sell|hold|reduce|trim)\b|(?<!\p{L})(?:alım|satım|saxlayım|azaldım|mövqeni\s+kiçildim)(?!\p{L})/iu;
const COMPARATIVE_SECURITY_SELECTION =
  /\bwhich\b[\s\S]{0,80}\b(?:buy|choose|select|invest\s+in)\b|\b(?:buy|choose|select)\b[\s\S]{0,80}\bwhich\b|(?<!\p{L})hans[ıi](?:n[ıi])?[\s\S]{0,80}(?:almaq|al[ıi]m|se[cç](?:m[əe]k|im)?|investisiya\s+etm[əe]k)(?!\p{L})/iu;
const HYPOTHETICAL_POSITION =
  /\b(?:assume|imagine|suppose|say)\s+i\s+(?:own|have)\b[\s\S]{0,120}\b\d+(?:\.\d+)?\s+shares?\b[\s\S]{0,120}\b(?:bought|purchased|acquired)\b[\s\S]{0,60}(?:USD\s*)?\$?\s*\d|(?<!\p{L})(?:fərz\s+et|ferz\s+et|tutaq\s+ki)[\s\S]{0,120}\d+(?:\.\d+)?\s+(?:[A-Z]{1,5}\s+)?s[əe]hm\p{L}*[\s\S]{0,120}(?:alm[ıi][şs]am|ald[ıi]m|al[ıi][şs]\s+qiym[əe]ti)[\s\S]{0,60}(?:USD\s*)?\$?\s*\d/iu;
const HYPOTHETICAL_PORTFOLIO_CONTEXT =
  /\b(?:imagine|assume|suppose|hypothetical|portfolio\s+(?:is|worth|of)|allocation)\b|(?<!\p{L})(?:hipotetik|portfel\p{L}*\s+(?:bölgü|b[öo]l[uü]nm[əe]|t[əe]rkib))(?!\p{L})/iu;
const COMPARE_SECURITIES =
  /\b(?:compare(?:d|s|ing)?|comparison|versus|vs\.?|müqayisə|muqayise)\b/iu;
const PRODUCT_KNOWLEDGE =
  /\b(?:Demo\s+Invest|onboarding|funding|withdrawal|deposit|market\s+hours|(?:trade|trande|trading)\s+(?:days?|hours?|restrictions?)|pre[ -]?market|after[ -]?market(?:\s+hours?)?|order\s+types?|purchase\s+operation|sale\s+operat(?:ion|on)|how\s+to\s+(?:purchase|buy)\b[^.!?\n]{0,50}\b(?:company\s+)?shares?|how\s+to\s+sell\b[^.!?\n]{0,50}\bshares?|investment\s+instruments?|securities?\s+(?:registered|reegistered|registration|custody)|whose\s+name\b[^.!?\n]{0,80}\bsecurities?|investment\s+(?:profit|gain)\p{L}*[^.!?\n]{0,40}(?:tax|taxation)|insur(?:ance|ence)\p{L}*[^.!?\n]{0,50}(?:securities|cash|investment\s+loss)|disclosure|policy|document|hesab\s+a[cç]|m[əe]daxil|m[əe]xaric|pul\s+[cç]ıxar|bazar\s+saat|ticar[əe]t\s+(?:g[uü]n|saat|m[əe]hdudiyy[əe]t)\p{L}*|sifari[şs]\s+n[oö]v|al[ıi][şs]\s+[əe]m[əe]liyyat|sat[ıi][şs]\s+[əe]m[əe]liyyat|investisiya\s+al[əe]t|qiym[əe]tli\s+ka[ğg][ıi]z\p{L}*[^.!?\n]{0,50}(?:kimin\s+ad[ıi]na|qeydiyyat|saxlan)|vergi|s[ıi][ğg]orta|qayda|siyas[əe]t|s[əe]n[əe]d)\b/iu;
const GOVERNED_FAQ_REQUEST =
  /^(?:what|which|who|whose|when|where|why|how|is|are|can|could|does|do|information\s+(?:about|on)|explain|tell\s+me\s+about)\b|^(?:nə|necə|niyə|kim|kimin|nə\s+vaxt|hansı|mümkündür|izah\s+et|haqqında\s+məlumat)\b|\?[\s]*$/iu;
const PROMPT_INJECTION =
  /\b(?:ignore|disregard|override|reveal|print|show)\b[\s\S]{0,50}\b(?:system|developer|hidden|policy|prompt|instructions?)\b|\b(?:jailbreak|prompt\s+injection)\b/iu;
const SENSITIVE =
  /\b(?:password|passcode|one[- ]time\s+password|OTP|PIN|CVV|card\s+number|account\s+number|secret|parol|bird[əe]f[əe]lik\s+[şs]ifr[əe]|kart\s+n[oö]mr[əe]|hesab\s+n[oö]mr[əe]|FIN\s+kod)\b/iu;
const LANGUAGE_SWITCH_REQUEST =
  /\b(?:answer|reply|respond|continue)\s+in\s+(?:azerbaijani|azeri|english)\b|(?<!\p{L})(?:az[əe]rbaycan|ingilis)\s+dilind[əe]\s+(?:cavab\s+ver|davam\s+et|yaz)(?!\p{L})/iu;
const OUT_OF_SCOPE_REQUEST =
  /\b(?:weather|forecast|temperature|football|soccer|basketball|recipe|cook|poem|lyrics|movie\s+recommendation|hotel|flight)\b|(?<!\p{L})(?:hava(?:\s+proqnozu)?|temperatur|futbol|basketbol|resept|yem[əe]k|şeir|seir|mahn[ıi]\s+sözl[əe]ri|otel|u[cç]u[şs])(?!\p{L})/iu;
const COMPOUND_KNOWLEDGE_REQUEST =
  /\b(?:fees?|tariffs?|commissions?)\b[\s\S]{0,100}\b(?:products?|instruments?|risks?|disclosures?|documents?)\b|\b(?:products?|instruments?|risks?|disclosures?|documents?)\b[\s\S]{0,100}\b(?:fees?|tariffs?|commissions?)\b|(?<!\p{L})(?:komissiya|tarif)\p{L}*[\s\S]{0,100}(?:məhsul|alet|alət|risk|açıqlama|sened|sənəd)\p{L}*(?!\p{L})/iu;
const EDUCATION_REQUEST =
  /\b(?:what\s+(?:is|are|happens)|what\s+does\b[\s\S]{0,80}\bmean|meaning\s+of|explain|define|tell\s+me\s+about|how\s+does|how\s+is|how\s+do\s+you|why\s+(?:did|has|have|can)|nədir|nedir|nə\s+olur|ne\s+olur|nə\s+deməkdir|ne\s+demekdir|mənası\s+nədir|menasi\s+nedir|nələrdir|nelerdir|hansılardır|hansilardir|izah\s+et|haqqında\s+danış|haqqinda\s+danis|necə\s+işləyir|nece\s+isleyir|necə\s+hesablanır|nece\s+hesablanir|niyə|necə\s+dəyiş)(?=$|[?.!,;:\s])/iu;
const FINANCIAL_EDUCATION_SCOPE =
  /\b(?:invest(?:ment|ing|or)|financ(?:e|ial)|asset|securit(?:y|ies)|stock|share|equity|bond|fixed[\s-]*income|fund|ETF|index|benchmark|portfolio|diversif\p{L}*|rebalanc\p{L}*|duration|maturity|interest\s+rate|yield|expense\s+ratio|tracking\s+error|liquidity|volatility|drawdown|dividend|capital\s+gain|market\s+order|limit\s+order|fractional\s+share|ADR|P\s*\/?\s*E|RSI|moving\s+average|TWR)\b|(?<!\p{L})(?:investisiya|maliyyə|aktiv|qiymətli\s+kağız|səhm|istiqraz|sabit\s+gəlir|fond|indeks|bençmark|portfel|şaxələndir\p{L}*|yenidən\s+balans\p{L}*|müddət|ödəmə\s+müddəti|faiz\s+dərəcəsi|gəlirlilik|xərc\s+əmsalı|izləmə\s+xətası|likvidlik|dəyişkənlik|maksimum\s+eniş|dividend|kapital\s+gəliri|bazar\s+sifarişi|limit\s+sifarişi|kəsr\s+səhm|nisbi\s+güc\s+indeksi|hərəkətli\s+orta)(?!\p{L})/iu;
const PERSONAL_PERFORMANCE_SCOPE =
  /\b(?:my|mine|for\s+me|show\s+(?:me\s+)?(?:my\s+)?|calculate\s+(?:my\s+)?|what\s+is\s+my|portfolio|account|result)\b|(?<!\p{L})(?:mənim|menim|mənə|mene|portfel\p{L}*|hesab\p{L}*|nəticəm|neticem|göstər|goster|hesabla|neçədir|necedir)(?!\p{L})/iu;
const TWR_TERM = /\bTWR\b/iu;
const BARE_TWR_REQUEST =
  /^\s*(?:test\s+)?TWR[?.!\s]*$/iu;
const SUITABILITY_EDUCATION =
  /\b(?:should\s+i\s+rebalance|rebalanc(?:e|ing)[\s\S]{0,100}(?:quarter|annual|year|how\s+often)|what\s+allocation\s+should\s+i\s+set|growth[\s\S]{0,100}not\s+too\s+volatile|if\s+i\s+(?:only\s+)?had\s+\$?[\d,]+[\s\S]{0,100}(?:invest|allocate)|where\s+would\s+you\s+allocate\s+it|how\s+would\s+warren\s+buffett\s+view\s+this\s+portfolio)\b|(?<!\p{L})(?:(?:yenidən\s+balans|rebalans)\p{L}*[\s\S]{0,100}(?:rüb|illik|nə\s+qədər\s+tez)|(?:artım|böyümə)\p{L}*[\s\S]{0,100}(?:az\s+dəyişkən|çox\s+dəyişkən\s+olmasın)|hansı\s+(?:portfel\s+)?bölgü\p{L}*\s+seç)(?!\p{L})/iu;
const BARE_PORTFOLIO_OVERVIEW =
  /^\s*(?:(?:show|open|view)\s+(?:me\s+)?)?(?:(?:my|the|this)\s+)?portfolio[?.!\s]*$|^\s*(?:(?:mənim|menim|bu)\s+)?portfel(?:im)?[?.!\s]*$/iu;
const PORTFOLIO_ADVISER_REVIEW =
  /\bif\s+you\s+were\s+my\s+investment\s+advis(?:er|or)\b|(?<!\p{L})investisiya\s+məsləhətçim\s+olsaydın(?!\p{L})/iu;
const AMBIGUOUS_FUND_YIELD =
  /\b(?:current|distribution|SEC|income|dividend|bond)\s+yield\b|\byield\s+(?:of|for)\b|(?<!\p{L})(?:cari\s+)?gəlirlili\p{L}*(?!\p{L})/iu;
const MARKET_EVENT_REQUEST =
  /\b(?:next|upcoming|expected|when\s+is)\s+(?:earnings|earnings\s+(?:date|report|release))\b|\bearnings\s+(?:date|calendar)\b|(?<!\p{L})(?:növbəti|novbeti|gözlənilən|gozlenilen)\s+(?:maliyyə\s+nəticələri|maliyye\s+neticeleri|hesabat)\s+(?:tarixi|vaxtı|vaxti)(?!\p{L})/iu;

function normalizeRoutingLexemes(message: string): string {
  return message
    .normalize("NFKC")
    .replace(
      /(?<!\p{L})(?:porfolio|portolio|portoflio)(?!\p{L})/giu,
      "portfolio",
    );
}

function hasPortfolioRiskIntent(message: string): boolean {
  return PORTFOLIO.test(message) && SECURITY_RISK.test(message);
}

const CONTINUATION_WITH_EXPLICIT_SUBJECT =
  /^\s*(?:and|also|same\s+for|what\s+about|how\s+about|then|bəs|və|həmçinin|eyni\s+şey)\b/iu;
const STRONG_CONTEXT_REFERENCE =
  /\b(?:it|its|itself|them|their|theirs|those|(?:this|that)\s+(?:one|company|stock|fund)|same\s+(?:one|company|stock|fund)|what\s+else)\b|(?<!\p{L})(?:onun|bunun|həmin|eyni|başqa\s+nə)(?!\p{L})/iu;
const SINGULAR_CONTEXT_REFERENCE =
  /\b(?:it|its|itself|(?:this|that)\s+(?:one|company|stock|fund)|same\s+(?:one|company|stock|fund))\b|(?<!\p{L})(?:onun|bunun|həmin)(?!\p{L})/iu;

/**
 * Reduces a deliberately narrow, facet-only follow-up to its semantic core.
 * This is not general language understanding: every accepted value is still
 * matched against an anchored allowlist below. Keeping the mapper exact stops
 * a vague follow-up from silently inheriting a capability from memory.
 */
function normalizeConversationFacet(message: string): string {
  let normalized = message
    .normalize("NFKC")
    .replace(/İ/gu, "I")
    .toLowerCase()
    .trim()
    .replace(/[?!.…]+$/gu, "")
    .trim();

  normalized = normalized.replace(
    /^(?:(?:and|also|then|same\s+for|what\s+about|how\s+about|bəs|bes|və|ve|həmçinin|hemcinin|eyni\s+şey)\s+)/u,
    "",
  );
  normalized = normalized.replace(
    /^(?:(?:what(?:'s|\s+is|\s+are)|show\s+me|tell\s+me|nədir|nedir|göstər|goster)\s+)/u,
    "",
  );
  normalized = normalized.replace(/^(?:the\s+)?(?:current|latest|cari|son|indiki)\s+/u, "");
  normalized = normalized.replace(
    /^(?:(?:the|its?|their|onun|bunun|həmin|hemin)\s+)/u,
    "",
  );
  normalized = normalized.replace(/^(?:the\s+)?(?:current|latest|cari|son|indiki)\s+/u, "");

  return normalized.replace(/\s+/gu, " ").trim();
}

function conversationFacetRoute(
  message: string,
): V3ConversationContextRoute | null {
  const facet = normalizeConversationFacet(message);

  if (/^(?:(?:stock|s[əe]hm)\s+)?(?:price|quote|qiym[əe]t(?:i|ini)?)$/u.test(facet)) {
    return "market_quote";
  }
  if (
    /^(?:risks?|risk\s+analysis|risk\s+analizi|risk(?:i(?:ni)?|l[əe]r(?:i(?:ni)?)?)?)$/u.test(
      facet,
    )
  ) {
    return "security_risk";
  }
  if (
    /^(?:news|sentiment|x[əe]b[əe]r(?:l[əe]r)?(?:i)?|bazar\s+[əe]hval(?:ı|i))$/u.test(
      facet,
    )
  ) {
    return "news_sentiment";
  }
  if (
    /^(?:indicators?|technical\s+analysis|indikator(?:lar|ları|lari)?|texniki\s+analiz)$/u.test(
      facet,
    )
  ) {
    return "technical_analysis";
  }
  if (
    /^(?:(?:1|one)\s*(?:y|yr|year)|yearly|(?:1\s*il|illik))\s+(?:performance|return|performans|g[əe]lir\p{L}*)$/u
      .test(facet)
  ) {
    return "market_history";
  }
  if (
    /^(?:average\s+(?:cost|price)|cost\s+basis|orta(?:lama)?\s+(?:(?:al[ıi][şs]\s+)?qiym[əe]t(?:i)?|(?:maya\s+)?d[əe]y[əe]r(?:i)?)|maya\s+d[əe]y[əe]r(?:i)?)$/u.test(
      facet,
    )
  ) {
    return "holding_average_cost";
  }

  return null;
}

export function isV3ConversationContextRoute(
  route: V3Function | null
): route is V3ConversationContextRoute {
  return route !== null && V3_CONVERSATION_CONTEXT_ROUTE_SET.has(route);
}

export function hasV3ConversationFollowUpMarker(
  message: string,
  options: {
    readonly explicitSymbols: boolean;
    readonly explicitFacet?: boolean;
  }
): boolean {
  if (STRONG_CONTEXT_REFERENCE.test(message) || conversationFacetRoute(message) !== null) {
    return true;
  }
  return (options.explicitSymbols || options.explicitFacet === true) &&
    CONTINUATION_WITH_EXPLICIT_SUBJECT.test(message);
}

/**
 * Applies only previously authenticated, bounded control-plane context. The
 * function does not read memory itself and cannot turn an order or safety
 * boundary into a contextual request.
 */
export function applyV3ConversationRouteContext(input: {
  readonly message: string;
  readonly route: V3RouteDecision;
  readonly rememberedRoute: V3ConversationContextRoute;
  readonly rememberedSymbols: readonly string[];
}): V3RouteDecision {
  const rememberedSymbols = Object.freeze([...new Set(input.rememberedSymbols)]);
  if (rememberedSymbols.length === 0 || rememberedSymbols.length > 2) return input.route;
  if (input.route.kind === "boundary" || input.route.route === "order_ticket_preview") {
    return input.route;
  }

  const explicitSymbols = input.route.symbols.length > 0;
  const facetRoute = conversationFacetRoute(input.message);
  if (!hasV3ConversationFollowUpMarker(input.message, {
    explicitSymbols,
    explicitFacet: isV3ConversationContextRoute(input.route.route)
  })) {
    return input.route;
  }
  if (
    !explicitSymbols &&
    rememberedSymbols.length > 1 &&
    SINGULAR_CONTEXT_REFERENCE.test(input.message)
  ) {
    return input.route;
  }

  if (isV3ConversationContextRoute(input.route.route)) {
    if (explicitSymbols) return input.route;
    if (
      input.route.route === "holding_average_cost" &&
      rememberedSymbols.length !== 1
    ) {
      return input.route;
    }
    return decision(
      input.route.kind,
      input.route.route,
      null,
      input.route.locale,
      rememberedSymbols,
      input.route.confidence,
      [...input.route.reasonCodes, "conversation_symbol_context"],
      input.route.researchFacet
    );
  }

  if (input.route.kind !== "clarify") return input.route;
  const contextualSymbols = explicitSymbols ? input.route.symbols : rememberedSymbols;
  const contextualRoute = facetRoute ?? input.rememberedRoute;
  if (
    contextualRoute === "holding_average_cost" &&
    contextualSymbols.length !== 1
  ) {
    return input.route;
  }
  return decision(
    (V3_MVP_FUNCTIONS as readonly string[]).includes(contextualRoute)
      ? "mvp"
      : "capability",
    contextualRoute,
    null,
    input.route.locale,
    contextualSymbols,
    0.96,
    [
      ...input.route.reasonCodes,
      facetRoute === null
        ? "conversation_intent_context"
        : "conversation_facet_context",
      ...(contextualRoute === "market_history"
        ? [`market_history_range:${detectV3MarketHistoryRange(input.message)}`]
        : []),
      ...(explicitSymbols ? [] : ["conversation_symbol_context"])
    ],
    input.route.researchFacet ??
      (contextualRoute === "company_research" || contextualRoute === "security_risk"
        ? "general"
        : null)
  );
}

function normalizeLocale(locale: V3RouteOptions["locale"]): V3Locale | null {
  if (locale === "az" || locale === "az-AZ") return "az-AZ";
  if (locale === "en" || locale === "en-US") return "en-US";
  return null;
}

function hasHypotheticalPortfolioAllocations(message: string): boolean {
  const percentages = message.match(
    /(?<![\p{L}\p{N}])(?:100|[1-9]?\d)(?:\.\d{1,2})?\s*%/gu
  ) ?? [];
  return percentages.length >= 2 &&
    HYPOTHETICAL_PORTFOLIO_CONTEXT.test(message);
}

export function detectV3Locale(message: string): V3Locale {
  return AZERBAIJANI_SIGNAL.test(message) ? "az-AZ" : "en-US";
}

/**
 * Extracts public market symbols only after masking reserved financial concepts.
 * This prevents phrases such as `P&L`, `YTD PNL`, and `ETF risk` from turning
 * into accidental ticker requests.
 */
export function extractV3Symbols(message: string): readonly string[] {
  const symbols: string[] = [];
  const add = (candidate: string, explicitlyMarked = false): void => {
    const normalized = candidate.toUpperCase();
    if (
      !RESERVED_NON_SYMBOL_TERMS.has(normalized) &&
      (explicitlyMarked || !COMMON_NON_SYMBOL_WORDS.has(normalized)) &&
      /^[A-Z]{1,5}(?:\.[A-Z])?$/.test(normalized) &&
      !symbols.includes(normalized)
    ) {
      symbols.push(normalized);
    }
  };

  for (const [pattern, symbol] of COMPANY_ALIASES) {
    if (pattern.test(message)) add(symbol, true);
  }

  const masked = message
    .replace(/\bP\s*\/\s*E\b/giu, " ")
    .replace(/P\s*(?:&|\/|and)\s*L/giu, " ")
    .replace(/\b(?:PNL|YTD|TWR|ETF(?:s)?)\b/giu, " ");

  for (const match of masked.matchAll(/\$([A-Za-z]{1,5}(?:\.[A-Za-z])?)/g)) {
    const symbol = match[1];
    if (symbol !== undefined) add(symbol, true);
  }

  for (const match of masked.matchAll(
    /\b(?:ticker|symbol)\s*[:=]?\s*\$?([A-Za-z]{1,5}(?:\.[A-Za-z])?)(?![\p{L}\p{N}_])/giu
  )) {
    const symbol = match[1];
    if (symbol !== undefined) add(symbol, true);
  }

  // JavaScript `\b` is ASCII-oriented even with the Unicode flag, so `Bəs`
  // would otherwise be split into the valid ticker `B` followed by a
  // non-ASCII letter. Use explicit Unicode letter/number boundaries instead.
  for (const match of masked.matchAll(
    /(?<![\p{L}\p{N}_])([A-Z]{1,5}(?:\.[A-Z])?)(?![\p{L}\p{N}_])/gu
  )) {
    const symbol = match[1];
    if (symbol !== undefined) add(symbol);
  }

  for (const match of masked.matchAll(
    /(?<![\p{L}\p{N}_])([a-z]{2,5})(?![\p{L}\p{N}_])/gu
  )) {
    const symbol = match[1];
    if (symbol !== undefined && KNOWN_LOWERCASE_SYMBOLS.has(symbol)) add(symbol);
  }

  if (
    /\b(?:s\s*&\s*p|standard\s*&\s*poor(?:'s)?)\s*500\s+(?:index\s+)?ETF\b/iu
      .test(message)
  ) {
    add("SPY");
  }

  return Object.freeze(symbols);
}

function decision(
  kind: V3RouteKind,
  route: V3Function | null,
  boundary: V3Boundary | null,
  locale: V3Locale,
  symbols: readonly string[],
  confidence: number,
  reasonCodes: readonly string[],
  researchFacet: V3ResearchFacet | null =
    route === "company_research" ||
      route === "security_risk" ||
      route === "security_decision_support"
      ? "general"
      : null,
): V3RouteDecision {
  const isMvp = route !== null && (V3_MVP_FUNCTIONS as readonly string[]).includes(route);
  const portfolioRoutes: readonly V3Function[] = [
    "recent_trading_activity",
    "purchase_history",
    "current_portfolio_value",
    "largest_holding",
    "ytd_gain_loss_twr",
    "holding_average_cost",
    "sector_allocation",
    "one_month_mover_contribution",
    "security_decision_support",
    "portfolio_allocation_analysis",
  ];
  const marketRoutes: readonly V3Function[] = [
    "market_quote",
    "market_history",
    "market_event",
    "company_research",
    "technical_analysis",
    "news_sentiment",
    "market_move_explanation",
    "security_risk",
    "security_decision_support",
    "ytd_gain_loss_twr",
    "portfolio_allocation_analysis",
    "hypothetical_position_analysis",
    "etf_explanation_risk",
    "order_ticket_preview",
  ];
  const knowledgeRoutes: readonly V3Function[] = [
    "fees_tariff",
    "approved_knowledge",
    "education",
  ];

  return Object.freeze({
    kind,
    route,
    mvpFunction: isMvp ? (route as V3MvpFunction) : null,
    researchFacet,
    boundary,
    locale,
    symbols,
    confidence,
    reasonCodes: Object.freeze([...reasonCodes]),
    requiresPortfolio: route !== null && portfolioRoutes.includes(route),
    requiresMarketData: route !== null && marketRoutes.includes(route),
    requiresKnowledge: route !== null && knowledgeRoutes.includes(route),
    readOnly: boundary === null,
  });
}

export function detectV3ResearchFacet(message: string): V3ResearchFacet {
  if (
    /\b(?:where|which\s+exchange)\b[\s\S]{0,60}\b(?:listed|listing|trade(?:d|s)?)\b|\b(?:listed|listing)\b|(?<!\p{L})(?:hansı|harada)[\s\S]{0,60}birja\p{L}*(?!\p{L})/iu
      .test(message)
  ) {
    return "listing";
  }
  if (/\bmarket\s*cap(?:italization)?\b|(?<!\p{L})bazar\s+kapitallaş\p{L}*(?!\p{L})/iu.test(message)) {
    return "market_cap";
  }
  if (
    /\bp\s*\/?\s*e\b|\bprice[\s-]*to[\s-]*earnings\b|\btrailing\s+p\/?e\b|\bforward\s+p\/?e\b|\bTTM\b/iu
      .test(message)
  ) {
    return "pe";
  }
  if (/\bdividend(?:s|\s+(?:yield|payment|history))?\b|(?<!\p{L})dividend\p{L}*(?!\p{L})/iu.test(message)) {
    return "dividend";
  }
  if (
    /\b52[\s-]*(?:week|wk)\b|(?<!\p{L})52\s+həftə\p{L}*(?!\p{L})/iu.test(message)
  ) {
    return "price_range";
  }
  if (
    /\banalyst(?:s|\s+(?:rating|consensus|target))?\b|\bconsensus\b|(?<!\p{L})(?:analitik|konsensus|hədəf\s+qiymət)\p{L}*(?!\p{L})/iu
      .test(message)
  ) {
    return "analyst_consensus";
  }
  if (
    SECURITY_RISK.test(message) &&
    COMPARE_SECURITIES.test(message)
  ) {
    return "risk_comparison";
  }
  return "general";
}

/**
 * Constructs a route after trusted deterministic code has already selected a
 * known capability. This avoids passing machine-known tool arguments back
 * through natural-language symbol extraction. It must not be used with a
 * route value supplied by a customer request.
 */
export function routeKnownV3Capability(
  input: V3KnownCapabilityRouteInput
): V3RouteDecision {
  const supported = new Set<V3Function>([
    ...V3_MVP_FUNCTIONS,
    ...V3_ADDITIONAL_CAPABILITIES
  ]);
  if (!supported.has(input.route)) {
    throw new Error("Known V3 capability route is unsupported.");
  }
  const symbols = [...new Set(input.symbols ?? [])];
  if (
    symbols.length > 2 ||
    ((input.route === "recent_trading_activity" || input.route === "purchase_history") &&
      symbols.length > 1) ||
    symbols.some((symbol) => !/^[A-Z]{1,5}(?:\.[A-Z])?$/u.test(symbol))
  ) {
    throw new Error("Known V3 capability symbols are invalid.");
  }
  if (!/^[-a-z0-9_:]{3,96}$/u.test(input.reasonCode)) {
    throw new Error("Known V3 capability reason code is invalid.");
  }
  const kind: V3RouteKind = (V3_MVP_FUNCTIONS as readonly string[]).includes(input.route)
    ? "mvp"
    : "capability";
  const researchFacet = input.researchFacet ?? null;
  if (
    researchFacet !== null &&
    !(V3_RESEARCH_FACETS as readonly string[]).includes(researchFacet)
  ) {
    throw new Error("Known V3 capability research facet is invalid.");
  }
  return decision(
    kind,
    input.route,
    null,
    input.locale,
    Object.freeze(symbols),
    1,
    [input.reasonCode],
    researchFacet
  );
}

export function routeV3Request(
  message: string,
  options: V3RouteOptions = {},
): V3RouteDecision {
  const trimmed = normalizeRoutingLexemes(message.trim());
  const locale = normalizeLocale(options.locale) ?? detectV3Locale(trimmed);
  const symbols = extractV3Symbols(trimmed);
  const semanticFrame = analyzeV3SemanticFrame(trimmed);

  if (trimmed.length === 0) {
    return decision("clarify", null, null, locale, symbols, 1, ["empty_message"]);
  }
  if (PROMPT_INJECTION.test(trimmed)) {
    return decision("boundary", null, "prompt_injection", locale, symbols, 1, [
      "prompt_injection_detected",
    ]);
  }
  if (SENSITIVE.test(trimmed)) {
    return decision("boundary", null, "sensitive_support", locale, symbols, 1, [
      "sensitive_data_detected",
    ]);
  }
  if (LANGUAGE_SWITCH_REQUEST.test(trimmed)) {
    return decision("clarify", null, null, locale, symbols, 1, [
      "language_switch_requires_new_session"
    ]);
  }
  if (symbols.length === 0 && OUT_OF_SCOPE_REQUEST.test(trimmed)) {
    return decision("clarify", null, null, locale, symbols, 1, [
      "out_of_scope_request"
    ]);
  }

  // Preview language cannot downgrade a second, explicitly sequenced trade
  // instruction into a read-only ticket. A single preview such as "preview
  // buying 10 shares" remains a legitimate read-only request below.
  if (PREVIEW.test(trimmed) && PREVIEW_THEN_EXECUTE_ORDER.test(trimmed)) {
    return decision("boundary", null, "order_execution", locale, symbols, 0.99, [
      "executable_order_requested",
    ]);
  }
  // A preview is deliberately checked before ordinary executable-order
  // language. It is still read-only and never authorizes execution.
  if ((PREVIEW.test(trimmed) && ORDER_LANGUAGE.test(trimmed)) || OPEN_TICKET.test(trimmed)) {
    if (symbols.length !== 1) {
      return decision("clarify", null, null, locale, symbols, 1, [
        "order_preview_single_instrument_required"
      ]);
    }
    const reviewedIntent = reviewOrderPreviewIntent(trimmed);
    if (reviewedIntent.status === "rejected") {
      return decision("clarify", null, null, locale, symbols, 1, [
        reviewedIntent.reasonCode
      ]);
    }
    return decision("mvp", "order_ticket_preview", null, locale, symbols, 0.99, [
      "read_only_order_preview",
    ]);
  }
  // An imperative remains an execution boundary even when the same message
  // also asks to display historical activity. Historical-only wording is
  // handled by the narrow read-only branches below.
  if (
    (IMPERATIVE_EXECUTE_ORDER.test(trimmed) && EXECUTE_ORDER.test(trimmed)) ||
    POLITE_OR_INDIRECT_EXECUTE_ORDER.test(trimmed)
  ) {
    return decision("boundary", null, "order_execution", locale, symbols, 0.99, [
      "executable_order_requested",
    ]);
  }
  if (hasHypotheticalPortfolioAllocations(trimmed)) {
    return decision(
      "capability",
      "hypothetical_portfolio_analysis",
      null,
      locale,
      [],
      0.99,
      ["user_supplied_hypothetical_allocation"],
      null
    );
  }
  if (hasPortfolioRiskIntent(trimmed)) {
    return decision(
      "capability",
      "portfolio_allocation_analysis",
      null,
      locale,
      [],
      0.99,
      ["portfolio_risk_analysis_marker"],
      null
    );
  }
  if (PORTFOLIO_ADVISER_REVIEW.test(trimmed)) {
    return decision(
      "capability",
      "portfolio_allocation_analysis",
      null,
      locale,
      [],
      0.99,
      ["portfolio_nonadvisory_review_marker"],
      null
    );
  }
  if (HYPOTHETICAL_POSITION.test(trimmed)) {
    if (symbols.length !== 1) {
      return decision("clarify", null, null, locale, symbols, 1, [
        "hypothetical_position_single_instrument_required"
      ]);
    }
    return decision(
      "capability",
      "hypothetical_position_analysis",
      null,
      locale,
      symbols,
      0.99,
      ["user_supplied_hypothetical_position"],
      null
    );
  }
  if (
    symbols.length === 2 &&
    (
      COMPARATIVE_SECURITY_SELECTION.test(trimmed) ||
      PERSONAL_SECURITY_DECISION.test(trimmed)
    )
  ) {
    return decision(
      "capability",
      "company_research",
      null,
      locale,
      symbols,
      0.99,
      ["neutral_security_selection_comparison"],
      "general"
    );
  }
  if (COMPARATIVE_SECURITY_SELECTION.test(trimmed)) {
    return decision("clarify", null, null, locale, symbols, 1, [
      "comparison_exactly_two_instruments_required"
    ]);
  }
  if (PERSONAL_SECURITY_DECISION.test(trimmed)) {
    if (symbols.length !== 1) {
      return decision("clarify", null, null, locale, symbols, 1, [
        "decision_support_single_instrument_required",
      ]);
    }
    return decision(
      "capability",
      "security_decision_support",
      null,
      locale,
      symbols,
      0.99,
      ["portfolio_aware_decision_support_marker"],
      "general"
    );
  }
  // Historical activity is read-only even when a user mentions buys or
  // orders. These narrow retrieval markers must be resolved before the
  // executable-order boundary; an imperative trade request still fails closed.
  if (ACTIVITY_DATE_RANGE_REQUEST.test(trimmed)) {
    return decision("clarify", null, null, locale, symbols, 1, [
      "activity_date_range_unsupported"
    ]);
  }
  if (ACCOUNT_FEE_OR_DIVIDEND_ACTIVITY.test(trimmed)) {
    return decision("clarify", null, null, locale, symbols, 1, [
      "account_fee_dividend_activity_unsupported"
    ]);
  }
  if (PURCHASE_HISTORY.test(trimmed)) {
    if (symbols.length > 1) {
      return decision("clarify", null, null, locale, symbols, 1, [
        "activity_single_instrument_required",
      ]);
    }
    return decision("capability", "purchase_history", null, locale, symbols, 0.99, [
      "purchase_history_marker",
    ]);
  }
  if (RECENT_TRADING_ACTIVITY.test(trimmed)) {
    if (symbols.length > 1) {
      return decision("clarify", null, null, locale, symbols, 1, [
        "activity_single_instrument_required",
      ]);
    }
    return decision("capability", "recent_trading_activity", null, locale, symbols, 0.99, [
      "recent_trading_activity_marker",
    ]);
  }
  // Average-cost questions describe an existing holding even when the user
  // says "purchase price" or "what price did I buy at". Resolve that semantic
  // phrase before the generic purchase/order boundary so historical wording
  // cannot be mistaken for a new trade instruction.
  if (AVERAGE_COST.test(trimmed)) {
    return decision("mvp", "holding_average_cost", null, locale, symbols, 0.99, [
      HISTORICAL_AVERAGE_COST.test(trimmed)
        ? "historical_average_cost_marker"
      : "average_cost_marker",
    ]);
  }
  if (semanticFrame.investmentSelection) {
    const horizonReasonCodes = [
      ...semanticFrame.includedHorizonMonths.map((months) =>
        `investment_horizon_months:${String(months)}`
      ),
      ...semanticFrame.excludedHorizonMonths.map((months) =>
        `investment_excluded_horizon_months:${String(months)}`
      )
    ];
    if (symbols.length === 0) {
      return decision("clarify", null, null, locale, symbols, 0.99, [
        "investment_selection_inputs_required",
        "investment_asset_class:ETF",
        ...horizonReasonCodes,
        "investment_missing:risk_tolerance",
        "investment_missing:liquidity_needs",
        "investment_missing:portfolio_context"
      ]);
    }
    if (symbols.length === 1) {
      return decision("mvp", "etf_explanation_risk", null, locale, symbols, 0.98, [
        "investment_selection_factors_marker",
        "investment_asset_class:ETF",
        ...horizonReasonCodes
      ]);
    }
    if (symbols.length === 2) {
      return decision(
        "capability",
        "company_research",
        null,
        locale,
        symbols,
        0.98,
        [
          "security_comparison_marker",
          "investment_selection_factors_marker",
          "investment_asset_class:ETF",
          ...horizonReasonCodes
        ],
        "general"
      );
    }
    return decision("clarify", null, null, locale, symbols, 1, [
      "comparison_exactly_two_instruments_required"
    ]);
  }
  const personalTwrMetric =
    TWR_TERM.test(trimmed) &&
    PERSONAL_PERFORMANCE_SCOPE.test(trimmed);
  const personalYearToDatePerformance =
    PERFORMANCE.test(trimmed) &&
    YEAR_TO_DATE.test(trimmed) &&
    PERSONAL_INVESTMENT_PERFORMANCE.test(trimmed);
  const currentPortfolioDataRequest =
    CURRENT_VALUE.test(trimmed) ||
    PORTFOLIO_VALUATION_PHRASE.test(trimmed) ||
    CASH_BALANCE.test(trimmed) ||
    BARE_PORTFOLIO_OVERVIEW.test(trimmed) ||
    PORTFOLIO_VALUE_CONVERSION_FOLLOW_UP.test(trimmed) ||
    personalYearToDatePerformance ||
    /\b(?:what(?:'s|\s+is)|show|list)\b[^.!?\n]{0,60}\b(?:in\s+my\s+portfolio|my\s+holdings?)\b/iu
      .test(trimmed) ||
    (
      PORTFOLIO.test(trimmed) &&
      (
        PERFORMANCE.test(trimmed) ||
        (YEAR_TO_DATE.test(trimmed) && NATURAL_PERFORMANCE_RESULT.test(trimmed))
      )
    );
  const educationQueryReason = symbols.length === 0
    ? financialEducationRouteReason(trimmed)
    : null;
  if (
    educationQueryReason !== null &&
    !personalTwrMetric &&
    !currentPortfolioDataRequest &&
    !PRODUCT_KNOWLEDGE.test(trimmed) &&
    !FEES.test(trimmed) &&
    !(
      ETF_TERM.test(trimmed) &&
      AMBIGUOUS_FUND_YIELD.test(trimmed)
    ) &&
    (
      (
        EDUCATION_REQUEST.test(trimmed) &&
        FINANCIAL_EDUCATION_SCOPE.test(trimmed)
      ) ||
      BARE_TWR_REQUEST.test(trimmed) ||
      SUITABILITY_EDUCATION.test(trimmed)
    ) &&
    !(ETF_TERM.test(trimmed) && SECURITY_RISK.test(trimmed))
  ) {
    return decision("capability", "education", null, locale, symbols, 0.99, [
      educationQueryReason,
    ]);
  }
  const governedNavigationTarget = detectGovernedNavigationTarget(trimmed);
  // Informational product FAQs must reach governed retrieval before the broad
  // buy/sell and security-risk classifiers. Explicit and polite execution
  // requests have already failed closed above, so this branch cannot authorize
  // an order.
  if (
    !FEES.test(trimmed) &&
    PRODUCT_KNOWLEDGE.test(trimmed) &&
    GOVERNED_FAQ_REQUEST.test(trimmed)
  ) {
    return decision("capability", "approved_knowledge", null, locale, symbols, 0.99, [
      governedNavigationTarget === null
        ? "approved_knowledge_faq_marker"
        : "governed_navigation_knowledge_marker",
    ]);
  }
  if (EXECUTE_ORDER.test(trimmed)) {
    return decision("boundary", null, "order_execution", locale, symbols, 0.99, [
      "executable_order_requested",
    ]);
  }
  const conversationalTurn = classifyV3ConversationalTurn(trimmed);
  if (conversationalTurn !== null) {
    return decision("capability", "conversation", null, locale, [], 1, [
      `conversation:${conversationalTurn}`,
    ]);
  }
  // Product navigation questions must be governed knowledge requests. This
  // check intentionally precedes both the generic portfolio default and quote
  // routing. A fee question remains on the fee-specific governed route.
  if (!FEES.test(trimmed) && governedNavigationTarget !== null) {
    return decision("capability", "approved_knowledge", null, locale, symbols, 0.99, [
      "governed_navigation_knowledge_marker",
    ]);
  }
  if (SECTOR_ALLOCATION.test(trimmed)) {
    return decision("mvp", "sector_allocation", null, locale, symbols, 0.99, [
      "sector_allocation_marker",
    ]);
  }
  if (LARGEST_HOLDING.test(trimmed)) {
    return decision("capability", "largest_holding", null, locale, symbols, 0.99, [
      "largest_holding_marker"
    ]);
  }
  if (MONTHLY_MOVER.test(trimmed)) {
    return decision(
      "mvp",
      "one_month_mover_contribution",
      null,
      locale,
      symbols,
      0.99,
      ["one_month_contribution_marker"],
    );
  }
  if (
    PORTFOLIO.test(trimmed) &&
    (
      PERFORMANCE.test(trimmed) ||
      (YEAR_TO_DATE.test(trimmed) && NATURAL_PERFORMANCE_RESULT.test(trimmed))
    )
  ) {
    return decision("mvp", "ytd_gain_loss_twr", null, locale, symbols, 0.99, [
      "portfolio_performance_marker",
    ]);
  }
  if (PERFORMANCE.test(trimmed) && /\b(?:YTD|TWR|P\s*(?:&|\/)\s*L)\b/iu.test(trimmed)) {
    return decision("mvp", "ytd_gain_loss_twr", null, locale, symbols, 0.98, [
      "reserved_performance_term",
    ]);
  }
  if (
    PERFORMANCE.test(trimmed) &&
    YEAR_TO_DATE.test(trimmed) &&
    PERSONAL_INVESTMENT_PERFORMANCE.test(trimmed)
  ) {
    return decision("mvp", "ytd_gain_loss_twr", null, locale, symbols, 0.98, [
      "natural_ytd_performance_marker",
    ]);
  }
  if (symbols.length === 0 && CASH_BALANCE.test(trimmed)) {
    return decision("mvp", "current_portfolio_value", null, locale, symbols, 0.99, [
      "cash_balance_marker",
    ]);
  }
  if (PORTFOLIO_VALUE_CONVERSION_FOLLOW_UP.test(trimmed) && AZN_TARGET.test(trimmed)) {
    return decision("mvp", "current_portfolio_value", null, locale, symbols, 0.99, [
      "portfolio_value_conversion_follow_up",
      "portfolio_value_currency:AZN"
    ]);
  }
  if (
    CURRENT_VALUE.test(trimmed) ||
    PORTFOLIO_VALUATION_PHRASE.test(trimmed) ||
    BARE_PORTFOLIO_OVERVIEW.test(trimmed)
  ) {
    return decision("mvp", "current_portfolio_value", null, locale, symbols, 0.96, [
      CURRENT_VALUE.test(trimmed) || PORTFOLIO_VALUATION_PHRASE.test(trimmed)
        ? "current_portfolio_value_marker"
        : "portfolio_default",
      ...(AZN_TARGET.test(trimmed) ? ["portfolio_value_currency:AZN"] : [])
    ]);
  }
  if (
    symbols.length === 0 &&
    ETF_TERM.test(trimmed) &&
    AMBIGUOUS_FUND_YIELD.test(trimmed)
  ) {
    return decision("clarify", null, null, locale, symbols, 0.99, [
      "yield_symbol_and_definition_required",
    ]);
  }
  if (
    SECURITY_RISK.test(trimmed) &&
    COMPARE_SECURITIES.test(trimmed) &&
    symbols.length >= 2
  ) {
    return decision("capability", "security_risk", null, locale, symbols, 0.99, [
      "security_risk_comparison_marker",
    ], "risk_comparison");
  }
  if (semanticFrame.marketMoveExplanation) {
    if (symbols.length !== 1) {
      return decision("clarify", null, null, locale, symbols, 1, [
        "market_move_single_instrument_required"
      ]);
    }
    return decision(
      "capability",
      "market_move_explanation",
      null,
      locale,
      symbols,
      0.99,
      ["market_move_explanation_marker"],
      null
    );
  }
  if (semanticFrame.securityComparison && symbols.length > 0) {
    if (symbols.length !== 2) {
      return decision("clarify", null, null, locale, symbols, 1, [
        "comparison_exactly_two_instruments_required"
      ]);
    }
    return decision(
      "capability",
      "company_research",
      null,
      locale,
      symbols,
      0.98,
      ["security_comparison_marker"],
      "general"
    );
  }
  if (ETF_TERM.test(trimmed) && EXPLAIN_OR_RISK.test(trimmed)) {
    return decision("mvp", "etf_explanation_risk", null, locale, symbols, 0.99, [
      "etf_concept_marker",
    ]);
  }
  if (FEES.test(trimmed)) {
    if (COMPOUND_KNOWLEDGE_REQUEST.test(trimmed)) {
      return decision("capability", "approved_knowledge", null, locale, symbols, 0.99, [
        "compound_approved_knowledge_marker"
      ]);
    }
    return decision("mvp", "fees_tariff", null, locale, symbols, 0.99, [
      "fee_tariff_marker",
    ]);
  }

  if (MARKET_HISTORY_REQUEST.test(trimmed) && symbols.length > 0) {
    if (CUSTOM_MARKET_DATE_RANGE.test(trimmed)) {
      return decision("clarify", null, null, locale, symbols, 1, [
        "market_history_custom_range_unsupported"
      ]);
    }
    const range = detectV3MarketHistoryRange(trimmed);
    return decision("capability", "market_history", null, locale, symbols, 0.98, [
      `market_history_range:${range}`
    ]);
  }
  if (TECHNICAL.test(trimmed)) {
    return decision("capability", "technical_analysis", null, locale, symbols, 0.97, [
      "technical_analysis_marker",
    ]);
  }
  if (NEWS_SENTIMENT.test(trimmed)) {
    return decision("capability", "news_sentiment", null, locale, symbols, 0.97, [
      "news_sentiment_marker",
    ]);
  }
  if (MARKET_EVENT_REQUEST.test(trimmed)) {
    return decision("capability", "market_event", null, locale, symbols, 0.98, [
      "market_event_marker"
    ]);
  }
  if (SECURITY_RISK.test(trimmed)) {
    return decision("capability", "security_risk", null, locale, symbols, 0.97, [
      "security_risk_marker",
    ], detectV3ResearchFacet(trimmed));
  }
  if (
    QUOTE.test(trimmed) ||
    (
      symbols.length > 0 &&
      /\b(?:price|quote|trading\s+at|quoted\s+at|qiym[əe]t)\b/iu.test(trimmed)
    )
  ) {
    return decision("capability", "market_quote", null, locale, symbols, 0.97, [
      "market_quote_marker",
      ...(AZN_TARGET.test(trimmed) ? ["market_quote_currency:AZN"] : [])
    ]);
  }
  if (
    COMPANY_RESEARCH.test(trimmed) ||
    COMPANY_RESEARCH_FACT.test(trimmed) ||
    (DECISION_FACTORS.test(trimmed) && symbols.length > 0) ||
    (COMPARE_SECURITIES.test(trimmed) && symbols.length >= 2)
  ) {
    return decision("capability", "company_research", null, locale, symbols, 0.95, [
      COMPARE_SECURITIES.test(trimmed)
        ? "security_comparison_marker"
        : DECISION_FACTORS.test(trimmed)
          ? "neutral_decision_factors_marker"
          : "company_research_marker",
    ], detectV3ResearchFacet(trimmed));
  }
  if (PRODUCT_KNOWLEDGE.test(trimmed)) {
    return decision("capability", "approved_knowledge", null, locale, symbols, 0.94, [
      "approved_knowledge_marker",
    ]);
  }

  return decision("clarify", null, null, locale, symbols, 0.45, [
    "no_deterministic_route",
  ]);
}
