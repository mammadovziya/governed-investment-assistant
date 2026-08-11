import type {
  AssistantCitation,
  ClaimDraft,
  EnvelopeIntegrity,
  FactEnvelope,
  SupportedLocale,
  ToolExecutionEnvelope
} from "./contracts.js";
import { EvidenceFactory } from "./evidence.js";
import { canonicalHash } from "./signing.js";

export const RENDERABLE_SEMANTIC_ROLES = [
  "instrument.identity",
  "instrument.type",
  "instrument.listing",
  "instrument.currency",
  "market.price",
  "market.close",
  "market.state",
  "market.change",
  "market.context",
  "source.identity",
  "source.time",
  "source.freshness",
  "source.limitation",
  "valuation.market_cap",
  "valuation.pe",
  "fundamental.earnings",
  "fundamental.dividend_amount",
  "fundamental.dividend_yield",
  "fundamental.revenue",
  "fundamental.income",
  "fundamental.margin",
  "fundamental.roe",
  "analyst.rating",
  "analyst.target",
  "risk.generic",
  "risk.volatility",
  "risk.drawdown",
  "risk.downside",
  "risk.duration",
  "risk.maturity",
  "risk.concentration",
  "risk.credit",
  "portfolio.identity",
  "portfolio.holding_value",
  "portfolio.cash",
  "portfolio.cost",
  "portfolio.balance",
  "portfolio.allocation",
  "portfolio.sector",
  "portfolio.return",
  "portfolio.contribution",
  "portfolio.mover",
  "portfolio.pnl",
  "portfolio.income",
  "portfolio.fees",
  "portfolio.fx",
  "knowledge.fee",
  "knowledge.commission",
  "knowledge.tariff",
  "knowledge.policy",
  "knowledge.disclosure",
  "knowledge.support",
  "knowledge.product",
  "knowledge.education",
  "activity.summary",
  "activity.record",
  "activity.coverage"
] as const;

export type RenderableSemanticRole =
  (typeof RENDERABLE_SEMANTIC_ROLES)[number];

export interface RenderableFact {
  alias: string;
  fact: FactEnvelope<unknown>;
  /** Value-free semantic description supplied to the constrained writer. */
  meaning: string;
  /** Required slots must be present in a successful writer composition. */
  required: boolean;
  display: string;
  /** Signed allow-list of material semantic roles this slot may label. */
  semanticRoles?: readonly RenderableSemanticRole[];
  /**
   * When present, the fact may only be rendered in a contiguous proposition
   * group closed by this exact citation alias.
   */
  requiredCitationAlias?: string;
  /** Signature over the complete deterministic projection, including roles. */
  projectionIntegrity?: EnvelopeIntegrity;
}

export interface RenderableCitation {
  alias: string;
  citation: AssistantCitation;
  /** Optional citations may be omitted from both prose and the final payload. */
  required: boolean;
}

export interface RenderedClaims {
  message: string;
  claims: ClaimDraft[];
  usedFactAliases: string[];
  usedFactIds: string[];
  usedCitationAliases: string[];
  usedCitationIds: string[];
  generationMode: "writer" | "deterministic-fallback";
}

export const WRITER_DRAFT_REJECTION_REASONS = [
  "draft_count",
  "alias_conflict",
  "claim_id_conflict",
  "claim_locale",
  "claim_limitations",
  "claim_exact_value",
  "claim_semantics",
  "claim_semantics_unsupported_conclusion",
  "claim_semantics_number_word",
  "claim_semantics_language",
  "claim_semantics_uppercase",
  "claim_semantics_unsupported_vocabulary",
  "claim_semantics_unsupported_material",
  "claim_semantics_no_fact_support",
  "claim_local_semantics",
  "claim_references",
  "fact_display_missing",
  "fact_projection_invalid",
  "fact_envelope_invalid",
  "citation_missing",
  "claim_placeholder_remaining",
  "claim_message_empty",
  "conversation_shape"
] as const;

export type WriterDraftRejectionReason =
  (typeof WRITER_DRAFT_REJECTION_REASONS)[number];

const PLACEHOLDER = /\{\{([A-Z][A-Z0-9_-]{0,31})\}\}/gu;
const UNSUPPORTED_CONCLUSION =
  /\b(?:buy|sell|hold|recommend(?:ed|ation)?|advice|should\s+(?:buy|sell|invest)|undervalued|overvalued|bullish|bearish|outperform|underperform|safer|safest|better|best|worse|worst|attractive|unattractive|likely|unlikely|guarantee(?:d)?|profitable|unprofitable|strong|weak|good|bad)\b|(?<!\p{L})(?:al(?:maq|ın|ış)|sat(?:maq|ın|ış)|saxla|tövsiyə|məsləhət|dəyərindən\s+(?:aşağı|yuxarı)|təhlükəsiz|daha\s+yaxşı|ən\s+yaxşı|cəlbedici|ehtimal|zəmanət|güclü|zəif)(?!\p{L})/iu;
const NUMBER_WORD =
  /\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|trillion|half|quarter|dozen)(?:[\s-]+(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|trillion|and)){0,5}\s+(?:dollars?|percent|shares?|units?|times?|days?|months?|years?)\b|(?<!\p{L})(?:sıfır|bir|iki|üç|dörd|beş|altı|yeddi|səkkiz|doqquz|on|iyirmi|otuz|qırx|əlli|altmış|yetmiş|səksən|doxsan|yüz|min|milyon|milyard|yarım)(?:[\s-]+(?:sıfır|bir|iki|üç|dörd|beş|altı|yeddi|səkkiz|doqquz|on|iyirmi|otuz|qırx|əlli|altmış|yetmiş|səksən|doxsan|yüz|min|milyon|milyard|və)){0,5}\s+(?:dollar|faiz|səhm|vahid|dəfə|gün|ay|il)(?!\p{L})/iu;
const SAFE_ENGLISH_SHELL_WORDS = new Set(
  `
  a about according across after again all also an and another any are
  as at available based be because been before both brief briefly
  but by can could course current currently describes detail did do does each either
  else essentially for from further has have here how however i idea if important in include includes
  including indicates into is it its keep key latest main may means mind no not now
  measure observed of on one only or other overall plain please point practical put relevant remember reported right says see shown
  shows simple simply since so that the their them then these this those through
  think to together us verified version was we were what when where which while with
  within without would you your hello hi welcome nice meet glad happy anytime help ready
  rewrite rephrase sentence section send
  `
    .trim()
    .split(/\s+/u)
);
const ENGLISH_SEMANTIC_VOCABULARY: ReadonlyArray<
  readonly [RegExp, readonly string[]]
> = [
  [
    /\b(?:price|quote|change|close|market|move|headline|news|context)\b/iu,
    ["price", "quote", "quoted", "trade", "trades", "trading", "change", "close", "market", "move", "headline", "news", "context", "possible"]
  ],
  [
    /\b(?:source|provider|evidence|freshness|observation|time|date|research|causality|cause|limitation)\b/iu,
    ["source", "provider", "evidence", "fresh", "freshness", "observed", "observation", "time", "date", "period", "range", "research", "causality", "cause", "limitation", "establish", "established"]
  ],
  [
    /\b(?:company|instrument|security|stock|share|fund|etf|bond|ticker|identity|name|listing|exchange|currency)\b/iu,
    ["company", "instrument", "security", "stock", "share", "fund", "etf", "bond", "ticker", "identity", "name", "listing", "listed", "exchange", "currency"]
  ],
  [
    /\b(?:valuation|capitalization|earnings|dividend|yield|analyst|rating|target|revenue|income|margin|return on equity|p\/?e)\b/iu,
    ["valuation", "capitalization", "cap", "earnings", "dividend", "distribution", "yield", "analyst", "rating", "target", "revenue", "income", "margin", "roe", "ratio"]
  ],
  [
    /\b(?:risk|volatility|drawdown|downside|duration|maturity|concentration|credit)\b/iu,
    ["risk", "risks", "indicator", "indicators", "volatility", "drawdown", "downside", "duration", "maturity", "concentration", "credit", "annualized", "historical"]
  ],
  [
    /\b(?:portfolio|holding|position|cash|cost|balance|allocation|sector|performance|return|contribution|mover|profit|loss|value)\b/iu,
    ["portfolio", "holding", "position", "cash", "cost", "balance", "allocation", "sector", "performance", "return", "contribution", "mover", "profit", "loss", "value", "worth", "result", "year", "year-to-date", "most"]
  ],
  [
    /\b(?:fee|commission|tariff|policy|disclosure|support|product|approved product|excerpt|guidance|education|concept|principle)\b/iu,
    ["fee", "fees", "commission", "tariff", "policy", "disclosure", "support", "product", "approved", "guidance", "document", "excerpt", "section", "education", "concept", "principle"]
  ]
];
const SAFE_AZERBAIJANI_SHELL_ROOTS = [
  "aid", "alınmalı", "ara", "aralığ", "artıq", "aşağıda", "aydın", "barədə", "başlanğıc", "başqa", "əsas",
  "belə", "bir", "birlikdə", "bu", "bun", "cari", "daxil", "daha", "də", "deyil",
  "digər", "dır", "dir", "dur", "dür", "ed", "et", "əvvəl", "görə",
  "haqqında", "hansı", "hazır", "həm", "ilk",
  "ilə", "isə", "izah", "kimi", "konkret", "kontekst", "qısa", "məhz",
  "məlumat", "məhdudiyyət", "məqam", "mövcud", "müddət", "müvafiq", "nə", "nəzərə",
  "ol", "qarşı", "qeyd", "sadə", "sadəcə", "son", "sonuncu", "sizin", "dövr",
  "tərəfindən", "təşkil", "təsdiq", "ümumi", "üçün", "üzrə", "və",
  "vacib", "ya", "yalnız", "yəni", "salam", "buyur", "sev", "məmnun", "xoş",
  "kömək", "təşəkkür", "dəyməz", "yenidən", "yaz", "göndər",
  "əlbəttə", "dəqiqləş", "de", "istə", "xahiş", "xidmət", "zəhmət", "məsəl",
  "soruş"
] as const;
const AZERBAIJANI_SEMANTIC_VOCABULARY: ReadonlyArray<
  readonly [RegExp, readonly string[]]
> = [
  [
    /\b(?:price|quote|change|close|market|move|headline|news|context)\b/iu,
    ["qiymət", "kotirovka", "ticarət", "bazar", "dəyiş", "bağlan", "başlıq", "xəbər", "kontekst", "mümkün"]
  ],
  [
    /\b(?:source|provider|evidence|freshness|observation|time|date|research|causality|cause|limitation)\b/iu,
    ["mənbə", "provayder", "sübut", "təzə", "tarix", "vaxt", "dövr", "aralıq", "müşahidə", "araşdırma", "məlumat", "səbəb", "əlaqə", "məhdudiyyət", "müəyyən", "təsdiq"]
  ],
  [
    /\b(?:company|instrument|security|stock|share|fund|etf|bond|ticker|identity|name|listing|exchange|currency)\b/iu,
    ["şirkət", "alət", "səhm", "fond", "etf", "istiqraz", "tiker", "ad", "listinq", "birja", "valyuta"]
  ],
  [
    /\b(?:valuation|capitalization|earnings|dividend|yield|analyst|rating|target|revenue|income|margin|return on equity|p\/?e)\b/iu,
    ["qiymətləndirmə", "kapitallaşma", "gəlir", "dividend", "paylanma", "analitik", "reytinq", "hədəf", "marja", "nisbət"]
  ],
  [
    /\b(?:risk|volatility|drawdown|downside|duration|maturity|concentration|credit)\b/iu,
    ["risk", "dəyişkənlik", "volatillik", "geriləmə", "enmə", "müddət", "ödəmə", "konsentrasiya", "kredit", "illik", "tarixi", "göstərici"]
  ],
  [
    /\b(?:portfolio|holding|position|cash|cost|balance|allocation|sector|performance|return|contribution|mover|profit|loss|value)\b/iu,
    ["portfel", "mövqe", "nağd", "vəsait", "maya", "balans", "bölgü", "sektor", "performans", "gəlir", "töhfə", "qazanc", "zərər", "dəyər", "nəticə", "il"]
  ],
  [
    /\b(?:fee|commission|tariff|policy|disclosure|support|product|approved product|excerpt|guidance|education|concept|principle)\b/iu,
    ["haqq", "komissiya", "tarif", "siyasət", "açıqlama", "dəstək", "məhsul", "təsdiq", "rəhbərlik", "sənəd", "bölmə", "təhsil", "anlayış", "prinsip", "məqam", "əsas"]
  ]
];
const SAFE_UPPERCASE_TERMS = new Set([
  "ADR",
  "ABB",
  "ETF",
  "P",
  "E",
  "PE",
  "RSI",
  "ROE",
  "SEC",
  "SMA",
  "EMA",
  "TTM",
  "TWR",
  "YTD"
]);
type MaterialTermRule =
  readonly [RegExp, readonly RenderableSemanticRole[]];

const ALL_RISK_ROLES: readonly RenderableSemanticRole[] = [
  "risk.generic",
  "risk.volatility",
  "risk.drawdown",
  "risk.downside",
  "risk.duration",
  "risk.maturity",
  "risk.concentration",
  "risk.credit"
];

const PORTFOLIO_SUMMARY_ROLES: readonly RenderableSemanticRole[] = [
  "portfolio.identity",
  "portfolio.holding_value",
  "portfolio.cash",
  "portfolio.balance",
  "portfolio.allocation",
  "portfolio.return",
  "portfolio.pnl"
];

const APPROVED_KNOWLEDGE_ROLES: readonly RenderableSemanticRole[] = [
  "knowledge.fee",
  "knowledge.commission",
  "knowledge.tariff",
  "knowledge.policy",
  "knowledge.disclosure",
  "knowledge.support",
  "knowledge.product",
  "knowledge.education"
];

const ENGLISH_MATERIAL_TERMS: ReadonlyArray<MaterialTermRule> = [
  [/\b(?:company|instrument|security|ticker|name)\b/iu,
    ["instrument.identity"]],
  [/\b(?:stock|share|fund|etf|bond)\b/iu, ["instrument.type"]],
  [/\b(?:listing|listed|exchange)\b/iu, ["instrument.listing"]],
  [/\b(?:currency|trades?\s+in)\b/iu, ["instrument.currency"]],
  [/\b(?:average|purchase|buy)\s+price\b|\bcost\s+basis\b/iu,
    ["portfolio.cost"]],
  [
    /(?<!average )(?<!purchase )(?<!buy )\bprice\b/iu,
    ["market.price", "market.close"]
  ],
  [/\bquote\b/iu, ["market.price"]],
  [/\b(?:trades?|traded|trading)\s+at\b/iu, ["market.price"]],
  [/(?<!previous )\bclose\b|\bclosing\b/iu, ["market.close"]],
  [/\bprevious\s+close\b/iu, ["market.change"]],
  [/\b(?:market\s+(?:state|open|closed)|market\s+is)\b/iu, ["market.state"]],
  [/\b(?:change|move)\b/iu,
    ["market.change", "portfolio.mover", "portfolio.contribution"]],
  [/\b(?:headline|news|market\s+context|possible\s+context)\b/iu,
    ["market.context"]],
  [/\b(?:source|provider|evidence|reported\s+by)\b/iu,
    ["source.identity", "source.limitation"]],
  [/\b(?:as\s+of|observation\s+time|timestamp|date|time)\b/iu,
    ["source.time", "risk.maturity"]],
  [/\b(?:freshness|staleness|delay)\b/iu, ["source.freshness"]],
  [/\b(?:causality|causal\s+link|evidence\s+limit(?:ation)?)\b/iu,
    ["source.limitation"]],
  [/\b(?:capitalization|market\s+cap)\b/iu, ["valuation.market_cap"]],
  [/\b(?:p\/?e|price-to-earnings)\b/iu, ["valuation.pe"]],
  [/\bearnings\b/iu, ["fundamental.earnings"]],
  [/\bdividend\b(?!\s+yield)/iu, ["fundamental.dividend_amount"]],
  [/\b(?:dividend\s+yield|distribution\s+yield|yield)\b/iu,
    ["fundamental.dividend_yield"]],
  [/\brevenue\b/iu, ["fundamental.revenue"]],
  [/\bincome\b/iu, ["fundamental.income", "portfolio.income"]],
  [/\bmargin\b/iu, ["fundamental.margin"]],
  [/\b(?:roe|return\s+on\s+equity)\b/iu, ["fundamental.roe"]],
  [/\b(?:analyst|rating|consensus)\b/iu, ["analyst.rating"]],
  [/\btarget\b/iu, ["analyst.target"]],
  [/\brisk\b/iu, ALL_RISK_ROLES],
  [/\bvolatility\b/iu, ["risk.volatility"]],
  [/\bdrawdown\b/iu, ["risk.drawdown"]],
  [/\bdownside\b/iu, ["risk.downside"]],
  [/\bduration\b/iu, ["risk.duration"]],
  [/\bmaturity\b/iu, ["risk.maturity"]],
  [/\bconcentration\b/iu, ["risk.concentration"]],
  [/\bcredit\b/iu, ["risk.credit"]],
  [/\bportfolio\b/iu, PORTFOLIO_SUMMARY_ROLES],
  [/\b(?:holding|holdings|position|positions)\b/iu,
    ["portfolio.identity", "portfolio.holding_value"]],
  [/\bcash\b/iu, ["portfolio.cash"]],
  [/\bcost\b/iu, ["portfolio.cost"]],
  [/\b(?:balance|portfolio\s+(?:current|total)?\s*value)\b/iu,
    ["portfolio.balance"]],
  [/\b(?:holding|position)\s+value\b/iu, ["portfolio.holding_value"]],
  [/\ballocation\b/iu, ["portfolio.allocation"]],
  [/\bsector\b/iu, ["portfolio.sector"]],
  [/\b(?:performance|return(?!\s+on\s+equity))\b/iu,
    ["portfolio.return", "market.change"]],
  [/\bcontribution\b/iu, ["portfolio.contribution"]],
  [/\bmover\b/iu, ["portfolio.mover"]],
  [/\b(?:profit|loss|net\s+result|p\s*&\s*l)\b/iu, ["portfolio.pnl"]],
  [/\bfee\b/iu, ["portfolio.fees", "knowledge.fee"]],
  [/\bcommission\b/iu,
    ["portfolio.fees", "knowledge.commission", "knowledge.fee"]],
  [/\btariff\b/iu, ["knowledge.tariff"]],
  [/\bpolicy\b/iu, ["knowledge.policy"]],
  [/\bdisclosure\b/iu, ["knowledge.disclosure"]],
  [/\bsupport\b/iu, ["knowledge.support"]],
  [/\bproduct\b/iu, ["knowledge.product"]],
  [/\b(?:education|concept|principle)\b/iu, ["knowledge.education"]],
  [/\b(?:transaction|activity|trade)\b/iu,
    ["activity.summary", "activity.record", "activity.coverage"]]
];

/*
 * JavaScript's `\b` is ASCII-oriented, so Azerbaijani rules use Unicode
 * letter boundaries explicitly. Inflectional suffixes are included inside
 * each reviewed root while materially different concepts remain separate.
 */
const AZERBAIJANI_MATERIAL_TERMS: ReadonlyArray<MaterialTermRule> = [
  [
    /(?<!\p{L})(?:şirkət|alət|tiker|şirkətin\s+adı|emitent)\p{L}*(?!\p{L})/iu,
    ["instrument.identity"]
  ],
  [
    /(?<!\p{L})(?:səhm|fond|etf|istiqraz|qiymətli\s+kağız)\p{L}*(?!\p{L})/iu,
    ["instrument.type"]
  ],
  [
    /(?<!\p{L})(?:listinq|birja|siyahıya\s+alın)\p{L}*(?!\p{L})/iu,
    ["instrument.listing"]
  ],
  [
    /(?<!\p{L})(?:valyuta|ticarət\s+valyutası)\p{L}*(?!\p{L})/iu,
    ["instrument.currency"]
  ],
  [
    /(?<!\p{L})(?:orta\s+(?:alış\s+)?qiymət|alış\s+qiymət|maya\s+dəyər)\p{L}*(?!\p{L})/iu,
    ["portfolio.cost"]
  ],
  [
    /(?<!orta )(?<!alış )(?<!maya )(?<!\p{L})(?:qiymət|kotirovka)\p{L}*(?!\p{L})/iu,
    ["market.price", "market.close"]
  ],
  [
    /(?<!\p{L})(?:bu\s+qiymətlə|qiymətində|səviyyəsində)\s+ticarət\s+olun\p{L}*(?!\p{L})/iu,
    ["market.price"]
  ],
  [
    /(?<!əvvəlki )(?<!öncəki )(?<!\p{L})bağlanış\p{L}*(?!\p{L})/iu,
    ["market.close"]
  ],
  [
    /(?<!\p{L})(?:əvvəlki|öncəki)\s+bağlanış\p{L}*(?!\p{L})/iu,
    ["market.change"]
  ],
  [
    /(?<!\p{L})bazar(?:ın)?\s+(?:vəziyyət|açıq|bağlı|qapalı)\p{L}*(?!\p{L})/iu,
    ["market.state"]
  ],
  [
    /(?<!\p{L})(?:dəyişiklik|dəyişmə|dəyişib|hərəkət)\p{L}*(?!\p{L})/iu,
    ["market.change", "portfolio.mover", "portfolio.contribution"]
  ],
  [
    /(?<!\p{L})(?:başlıq|xəbər|bazar\s+konteksti|mümkün\s+kontekst)\p{L}*(?!\p{L})/iu,
    ["market.context"]
  ],
  [
    /(?<!\p{L})(?:mənbə|provayder|sübut)\p{L}*(?!\p{L})/iu,
    ["source.identity", "source.limitation"]
  ],
  [
    /(?<!\p{L})(?:tarixinə|tarixində|tarix\s+etibarilə|müşahidə\s+vaxtı|vaxt)\p{L}*(?!\p{L})/iu,
    ["source.time", "risk.maturity"]
  ],
  [
    /(?<!\p{L})(?:təzəlik|aktuallıq|gecikmə)\p{L}*(?!\p{L})/iu,
    ["source.freshness"]
  ],
  [
    /(?<!\p{L})(?:səbəb\s+əlaqəsi|sübut\s+məhdudiyyəti)\p{L}*(?!\p{L})/iu,
    ["source.limitation"]
  ],
  [
    /(?<!\p{L})bazar\s+kapitallaşma\p{L}*(?!\p{L})/iu,
    ["valuation.market_cap"]
  ],
  [
    /(?<!\p{L})(?:mənfəət|qazanc)\p{L}*(?!\p{L})/iu,
    ["fundamental.earnings"]
  ],
  [
    /(?<!\p{L})dividend(?!\s+gəlirlilik)\p{L}*(?!\p{L})/iu,
    ["fundamental.dividend_amount"]
  ],
  [
    /(?<!\p{L})(?:dividend|paylanma)\s+gəlirlili(?:k|y)\p{L}*(?!\p{L})/iu,
    ["fundamental.dividend_yield"]
  ],
  [
    /(?<!\p{L})(?:satış\s+gəliri|dövriyyə)\p{L}*(?!\p{L})/iu,
    ["fundamental.revenue"]
  ],
  [
    /(?<!\p{L})xalis\s+gəlir\p{L}*(?!\p{L})/iu,
    ["fundamental.income", "portfolio.income"]
  ],
  [/(?<!\p{L})marja\p{L}*(?!\p{L})/iu, ["fundamental.margin"]],
  [
    /(?<!\p{L})(?:kapital\s+gəlirliliyi|roe)(?!\p{L})/iu,
    ["fundamental.roe"]
  ],
  [
    /(?<!\p{L})(?:analitik|reytinq|konsensus)\p{L}*(?!\p{L})/iu,
    ["analyst.rating"]
  ],
  [/(?<!\p{L})hədəf\p{L}*(?!\p{L})/iu, ["analyst.target"]],
  [/(?<!\p{L})risk\p{L}*(?!\p{L})/iu, ALL_RISK_ROLES],
  [
    /(?<!\p{L})(?:dəyişkənlik|volatillik)\p{L}*(?!\p{L})/iu,
    ["risk.volatility"]
  ],
  [
    /(?<!\p{L})(?:maksimum\s+eniş|geriləmə)\p{L}*(?!\p{L})/iu,
    ["risk.drawdown"]
  ],
  [
    /(?<!\p{L})(?:aşağı\s+yönlü|enmə)\p{L}*(?!\p{L})/iu,
    ["risk.downside"]
  ],
  [
    /(?<!\p{L})müddət\p{L}*(?!\p{L})/iu,
    ["risk.duration", "source.time", "knowledge.policy", "knowledge.product"]
  ],
  [
    /(?<!\p{L})(?:ödəmə\s+tarixi|ödəmə\s+müddəti)\p{L}*(?!\p{L})/iu,
    ["risk.maturity"]
  ],
  [/(?<!\p{L})konsentrasiya\p{L}*(?!\p{L})/iu, ["risk.concentration"]],
  [/(?<!\p{L})kredit\p{L}*(?!\p{L})/iu, ["risk.credit"]],
  [/(?<!\p{L})portfel\p{L}*(?!\p{L})/iu, PORTFOLIO_SUMMARY_ROLES],
  [
    /(?<!\p{L})(?:mövqe|saxlanılan\s+aktiv)\p{L}*(?!\p{L})/iu,
    ["portfolio.identity", "portfolio.holding_value"]
  ],
  [
    /(?<!\p{L})(?:nağd(?:\s+pul)?|sərbəst\s+vəsait)\p{L}*(?!\p{L})/iu,
    ["portfolio.cash"]
  ],
  [
    /(?<!\p{L})(?:maya\s+dəyər|orta\s+(?:alış\s+)?qiymət|alış\s+qiymət)\p{L}*(?!\p{L})/iu,
    ["portfolio.cost"]
  ],
  [
    /(?<!\p{L})(?:balans|portfel(?:in)?\s+(?:cari|ümumi)\s+dəyər)\p{L}*(?!\p{L})/iu,
    ["portfolio.balance"]
  ],
  [
    /(?<!\p{L})(?:mövqe|aktiv)\s+dəyər\p{L}*(?!\p{L})/iu,
    ["portfolio.holding_value"]
  ],
  [
    /(?<!\p{L})(?:bölgü|paylanma(?!\s+gəlirlili(?:k|y))|portfel(?:in)?\s+faiz)\p{L}*(?!\p{L})/iu,
    ["portfolio.allocation"]
  ],
  [/(?<!\p{L})sektor\p{L}*(?!\p{L})/iu, ["portfolio.sector"]],
  [
    /(?<!xalis )(?<!satış )(?<!dividend )(?<!paylanma )(?<!kupon )(?<!kapital )(?<!\p{L})(?:gəlir|gəlirlilik|performans)\p{L}*(?!\p{L})/iu,
    ["portfolio.return", "market.change"]
  ],
  [/(?<!\p{L})töhfə\p{L}*(?!\p{L})/iu, ["portfolio.contribution"]],
  [
    /(?<!\p{L})(?:ən\s+çox\s+dəyişən|hərəkət\s+lideri)\p{L}*(?!\p{L})/iu,
    ["portfolio.mover"]
  ],
  [
    /(?<!\p{L})(?:qazanc|zərər|xalis\s+nəticə)\p{L}*(?!\p{L})/iu,
    ["portfolio.pnl"]
  ],
  [
    /(?<!\p{L})(?:haqq|xidmət\s+haqqı)\p{L}*(?!\p{L})/iu,
    ["portfolio.fees", "knowledge.fee"]
  ],
  [
    /(?<!\p{L})komissiya\p{L}*(?!\p{L})/iu,
    ["portfolio.fees", "knowledge.commission", "knowledge.fee"]
  ],
  [/(?<!\p{L})tarif\p{L}*(?!\p{L})/iu, ["knowledge.tariff"]],
  [/(?<!\p{L})siyasət\p{L}*(?!\p{L})/iu, ["knowledge.policy"]],
  [/(?<!\p{L})açıqlama\p{L}*(?!\p{L})/iu, ["knowledge.disclosure"]],
  [/(?<!\p{L})dəstək\p{L}*(?!\p{L})/iu, ["knowledge.support"]],
  [/(?<!\p{L})məhsul\p{L}*(?!\p{L})/iu, ["knowledge.product"]],
  [
    /(?<!\p{L})(?:təhsil|anlayış|prinsip|əsas\s+məqam)\p{L}*(?!\p{L})/iu,
    ["knowledge.education"]
  ],
  [
    /(?<!\p{L})(?:əməliyyat|aktivlik|ticarət\s+tarixçəsi|alış\s+tarixçəsi)\p{L}*(?!\p{L})/iu,
    ["activity.summary", "activity.record", "activity.coverage"]
  ]
];

const MATERIAL_TERMS: ReadonlyArray<
  readonly [RegExp, readonly RenderableSemanticRole[]]
> = [
  ...ENGLISH_MATERIAL_TERMS,
  ...AZERBAIJANI_MATERIAL_TERMS
];

const AZERBAIJANI_MATERIAL_LABEL_AT_END =
  /(?:şirkət|alət|tiker|emitent|səhm|fond|etf|istiqraz|listinq|birja|valyuta|qiymət|kotirovka|bağlanış|dəyişiklik|dəyişmə|hərəkət|başlıq|xəbər|kontekst|səbəb\s+əlaqəsi|sübut\s+məhdudiyyəti|mənbə|provayder|sübut|tarix|vaxt|təzəlik|aktuallıq|gecikmə|bazar\s+kapitallaşması|p\/?e|mənfəət|qazanc|dividend|gəlirlilik|dövriyyə|gəlir|marja|roe|analitik|reytinq|konsensus|hədəf|risk|dəyişkənlik|volatillik|eniş|geriləmə|enmə|müddət|konsentrasiya|kredit|portfel|mövqe|aktiv|nağd|vəsait|dəyər|balans|bölgü|paylanma|faiz|sektor|performans|töhfə|zərər|nəticə|haqq|komissiya|tarif|siyasət|açıqlama|dəstək|məhsul|əməliyyat|aktivlik|tarixçə)\p{L}*(?:\s+isə)?\s*$/iu;

const AZERBAIJANI_PREVIOUS_SLOT_COPULA =
  /(?:\p{L}+(?:dır|dir|dur|dür)|olub|idi|təşkil\s+edir)\s*[,;:]?\s*$/iu;

const CONVERSATION_CAPABILITY_ROLES: readonly RenderableSemanticRole[] = [
  "instrument.identity",
  "instrument.type",
  "market.price",
  "market.change",
  "valuation.market_cap",
  "valuation.pe",
  "fundamental.dividend_yield",
  "risk.generic",
  "portfolio.identity",
  "portfolio.holding_value",
  "portfolio.cash",
  "portfolio.cost",
  "portfolio.balance",
  "portfolio.allocation",
  "portfolio.sector",
  "portfolio.return",
  "portfolio.contribution",
  "portfolio.mover",
  "portfolio.pnl",
  "portfolio.income",
  "portfolio.fees",
  "knowledge.fee",
  "knowledge.commission",
  "knowledge.tariff",
  "knowledge.policy",
  "knowledge.disclosure",
  "knowledge.support",
  "knowledge.product",
  "knowledge.education",
  "activity.summary"
];

function semanticRolesForAlias(alias: string): readonly RenderableSemanticRole[] {
  if (/^(?:CONVERSATION|CLARIFICATION|EDU)_/u.test(alias)) {
    return CONVERSATION_CAPABILITY_ROLES;
  }
  if (alias === "ACTIVITY_SUMMARY") return ["activity.summary"];
  if (/^ACTIVITY_ITEM_/u.test(alias)) {
    return ["activity.record", "portfolio.identity"];
  }
  if (/^ACTIVITY_(?:HAS_MORE|COVERAGE)$/u.test(alias)) {
    return ["activity.coverage", "source.time"];
  }
  if (
    /(?:^|_)IDENTITY$/u.test(alias) ||
    /(?:^|_)(?:MOVER|CONTRIBUTOR)_SYMBOL$/u.test(alias)
  ) {
    return ["instrument.identity", "portfolio.identity"];
  }
  if (/(?:^|_)CLASSIFICATION$/u.test(alias)) return ["instrument.type"];
  if (/(?:^|_)EXCHANGE$/u.test(alias)) return ["instrument.listing"];
  if (/(?:^|_)CURRENCY$/u.test(alias)) return ["instrument.currency"];
  if (
    /(?:^|_)LATEST_CLOSE$/u.test(alias) ||
    /(?:^|_)(?:START|END|PERIOD_HIGH|PERIOD_LOW|PRICE_BASIS)$/u.test(alias)
  ) {
    return ["market.close"];
  }
  if (/(?:^|_)PRICE$/u.test(alias)) return ["market.price"];
  if (/(?:^|_)QUOTE$/u.test(alias)) return ["market.price", "market.change"];
  if (/(?:^|_)CHANGE$/u.test(alias)) return ["market.change"];
  if (/(?:^|_)MARKET_CONTEXT$/u.test(alias)) {
    return ["market.state", "source.freshness"];
  }
  if (/(?:^|_)SOURCE$/u.test(alias)) {
    return ["source.identity", "source.time", "source.freshness"];
  }
  if (/(?:^|_)TIME$/u.test(alias)) return ["source.time"];
  if (/(?:^|_)MARKET_CAP$/u.test(alias)) return ["valuation.market_cap"];
  if (/(?:^|_)(?:TRAILING|FORWARD)_PE$/u.test(alias)) return ["valuation.pe"];
  if (
    /(?:^|_)DIVIDEND_YIELD$/u.test(alias) ||
    /(?:^|_)DISTRIBUTION$/u.test(alias)
  ) {
    return ["fundamental.dividend_yield"];
  }
  if (/(?:^|_)LAST_DIVIDEND$/u.test(alias)) {
    return ["fundamental.dividend_amount"];
  }
  if (/(?:^|_)ROE$/u.test(alias)) return ["fundamental.roe"];
  if (/(?:^|_)CONSENSUS$/u.test(alias)) {
    return ["analyst.rating", "analyst.target"];
  }
  if (/(?:^|_)TARGET$/u.test(alias)) return ["analyst.target"];
  if (/(?:^|_)DOWNSIDE_VOLATILITY$/u.test(alias)) return ["risk.downside"];
  if (/(?:^|_)VOLATILITY$/u.test(alias)) return ["risk.volatility"];
  if (/(?:^|_)DRAWDOWN$/u.test(alias)) return ["risk.drawdown"];
  if (/(?:^|_)HISTORICAL_RISK$/u.test(alias)) {
    return ["risk.generic", "risk.volatility", "risk.drawdown"];
  }
  if (/(?:^|_)RATE_RISK$/u.test(alias)) {
    return ["risk.generic", "risk.duration", "risk.maturity"];
  }
  if (/(?:^|_)CONCENTRATION$/u.test(alias)) return ["risk.concentration"];
  if (/(?:^|_)CREDIT$/u.test(alias)) return ["risk.credit"];
  if (/(?:^|_)EXPENSE$/u.test(alias)) return ["knowledge.fee"];
  if (/(?:^|_)TOTAL_VALUE$/u.test(alias)) return ["portfolio.balance"];
  if (
    /(?:^|_)MARKET_VALUE$/u.test(alias) ||
    /(?:^|_)HOLDINGS_VALUE$/u.test(alias)
  ) {
    return ["portfolio.holding_value"];
  }
  if (/(?:^|_)CASH_VALUE$/u.test(alias)) return ["portfolio.cash"];
  if (/(?:^|_)AVERAGE_COST$/u.test(alias)) return ["portfolio.cost"];
  if (/(?:^|_)SECTOR$/u.test(alias)) return ["portfolio.sector"];
  if (/(?:^|_)ALLOCATION$/u.test(alias)) return ["portfolio.allocation"];
  if (/(?:^|_)MOVER_RETURN$/u.test(alias)) {
    return ["portfolio.mover", "portfolio.return"];
  }
  if (/(?:^|_)CONTRIBUTION_(?:VALUE|RATE)$/u.test(alias)) {
    return ["portfolio.contribution"];
  }
  if (/(?:^|_)TWR$/u.test(alias)) return ["portfolio.return"];
  if (/(?:^|_)(?:NET_RESULT|REALIZED_PNL|UNREALIZED_PNL)$/u.test(alias)) {
    return ["portfolio.pnl"];
  }
  if (/(?:^|_)INCOME$/u.test(alias)) return ["portfolio.income"];
  if (/(?:^|_)FEES$/u.test(alias)) return ["portfolio.fees"];
  if (/(?:^|_)FX_IMPACT$/u.test(alias)) return ["portfolio.fx"];
  return [];
}

function semanticRolesForFactKind(
  kind: string
): readonly RenderableSemanticRole[] {
  if (kind === "education.approved-retrieval") {
    return ["knowledge.education"];
  }
  if (kind === "approved-knowledge.evidence") {
    return APPROVED_KNOWLEDGE_ROLES;
  }
  if (kind === "market.price") return ["market.price"];
  if (kind === "market.quote") {
    return [
      "instrument.identity",
      "market.price",
      "market.change",
      "market.state",
      "source.time",
      "source.freshness"
    ];
  }
  if (kind === "market.price-history") {
    return ["instrument.identity", "market.close", "market.change", "source.time"];
  }
  if (kind === "market.company-research.listing") {
    return [
      "instrument.identity",
      "instrument.listing",
      "instrument.currency",
      "source.identity",
      "source.time"
    ];
  }
  if (kind.includes("market-cap")) return ["valuation.market_cap"];
  if (kind.endsWith(".pe")) return ["valuation.pe"];
  if (kind.endsWith(".dividend")) {
    return ["fundamental.dividend_amount", "fundamental.dividend_yield"];
  }
  if (kind.includes("technical")) {
    return ["market.close", "risk.volatility", "source.identity", "source.time"];
  }
  if (kind.includes("risk")) {
    return [
      "risk.generic",
      "risk.volatility",
      "risk.drawdown",
      "risk.downside",
      "risk.duration",
      "risk.maturity",
      "risk.concentration",
      "risk.credit"
    ];
  }
  if (kind === "portfolio.current-value") {
    return ["portfolio.balance", "portfolio.cash", "portfolio.holding_value"];
  }
  if (kind === "portfolio.average-cost") {
    return ["portfolio.identity", "portfolio.cost"];
  }
  if (kind === "portfolio.sector-allocation") {
    return ["portfolio.sector", "portfolio.allocation"];
  }
  if (kind === "portfolio.one-month-mover") {
    return [
      "portfolio.identity",
      "portfolio.mover",
      "portfolio.contribution",
      "portfolio.return"
    ];
  }
  if (kind === "portfolio.ytd-pnl" || kind === "portfolio.unrealized-pnl") {
    return ["portfolio.pnl", "portfolio.income", "portfolio.fees", "portfolio.fx"];
  }
  if (kind === "portfolio.time-weighted-return") return ["portfolio.return"];
  if (kind.startsWith("portfolio.activity")) {
    return ["activity.summary", "activity.record", "activity.coverage"];
  }
  return [];
}

export function renderableFactProjectionPayload(
  item: Pick<
    RenderableFact,
    "alias" |
    "fact" |
    "display" |
    "meaning" |
    "required" |
    "semanticRoles" |
    "requiredCitationAlias"
  >
): Record<string, unknown> {
  return {
    schemaVersion: "assistant-v3.renderable-fact-projection.v1",
    formatterVersion: "assistant-v3.presentation-format.v1",
    alias: item.alias,
    factId: item.fact.factId,
    factEnvelopeHash: canonicalHash(item.fact),
    display: item.display,
    meaning: item.meaning,
    required: item.required,
    semanticRoles: [...(item.semanticRoles ?? [])],
    requiredCitationAlias: item.requiredCitationAlias ?? null
  };
}

export function sealRenderableFact(
  item: Omit<RenderableFact, "projectionIntegrity">,
  evidence: EvidenceFactory
): RenderableFact {
  const inferredRoles = semanticRolesForAlias(item.alias);
  const normalized = {
    ...item,
    semanticRoles: [...new Set(
      item.semanticRoles ??
      (inferredRoles.length > 0
        ? inferredRoles
        : semanticRolesForFactKind(item.fact.kind))
    )].sort()
  };
  return {
    ...normalized,
    projectionIntegrity: evidence.sealProjection(
      renderableFactProjectionPayload(normalized)
    )
  };
}

export function verifyRenderableFactProjection(
  item: RenderableFact,
  evidence: EvidenceFactory
): boolean {
  return item.projectionIntegrity !== undefined &&
    evidence.verifyProjection(
      renderableFactProjectionPayload(item),
      item.projectionIntegrity
    );
}

function normalizeSentence(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/\s+/gu, " ")
    // A signed fact display may already end in punctuation while the bounded
    // writer template adds its own sentence terminator. Collapse only repeated
    // terminal punctuation; decimal points and abbreviations are untouched.
    .replace(/([.!?])\1+(?=\s|$)/gu, "$1")
    // A cited proposition can itself end in punctuation while the writer uses
    // a semicolon to attach its already-verified citation placeholder. Remove
    // only that redundant terminator immediately before a rendered citation.
    .replace(/[.!?];(?=\s*\[\d+\])/gu, ";")
    .trim();
}

function referencesIn(template: string): string[] {
  return [...template.matchAll(PLACEHOLDER)].map((match) => match[1] as string);
}

function containsUngroundedExactValue(template: string): boolean {
  const withoutReferences = template
    .normalize("NFKC")
    .replace(PLACEHOLDER, "");
  return /[\p{N}$€£₼%]/u.test(withoutReferences) ||
    /https?:\/\//iu.test(withoutReferences);
}

function templateLanguageMatches(
  templateWithoutReferences: string,
  locale: SupportedLocale
): boolean {
  if (!/\p{L}/u.test(templateWithoutReferences)) return true;
  const azSignal =
    /[əğıöşüçİ]|(?<!\p{L})(?:üçün|üzrə|ilə|isə|cari|mənbə|göstərici|dəyər|portfel|səhm|qiymət|gəlir|zərər|məlumat)(?!\p{L})/u;
  return locale === "az-AZ"
    ? azSignal.test(templateWithoutReferences)
    : !azSignal.test(templateWithoutReferences);
}

function englishStem(value: string): string {
  if (value.length <= 3) return value;
  if (value.endsWith("ies") && value.length > 4) return `${value.slice(0, -3)}y`;
  for (const suffix of ["ingly", "edly", "ing", "ed", "es", "s", "ly"]) {
    if (value.endsWith(suffix) && value.length > suffix.length + 3) {
      return value.slice(0, -suffix.length);
    }
  }
  return value;
}

function vocabularyIndexesForRoles(
  roles: ReadonlySet<RenderableSemanticRole>
): number[] {
  const indexes = new Set<number>();
  for (const role of roles) {
    if (role.startsWith("market.")) indexes.add(0);
    if (role.startsWith("source.")) indexes.add(1);
    if (role.startsWith("instrument.")) indexes.add(2);
    if (
      role.startsWith("valuation.") ||
      role.startsWith("fundamental.") ||
      role.startsWith("analyst.")
    ) {
      indexes.add(3);
    }
    if (role.startsWith("risk.")) indexes.add(4);
    if (role.startsWith("portfolio.")) indexes.add(5);
    if (role.startsWith("knowledge.")) indexes.add(6);
  }
  return [...indexes];
}

function englishShellVocabularyIsSupported(
  shell: string,
  meanings: string,
  semanticRoles: ReadonlySet<RenderableSemanticRole>
): boolean {
  const allowed = new Set(
    [...SAFE_ENGLISH_SHELL_WORDS].map(englishStem)
  );
  const addWords = (value: string): void => {
    for (const token of value.toLocaleLowerCase("en-US").match(/\p{L}+(?:-\p{L}+)*/gu) ?? []) {
      allowed.add(englishStem(token));
    }
  };
  addWords(meanings);
  for (const [supportedBy, vocabulary] of ENGLISH_SEMANTIC_VOCABULARY) {
    if (supportedBy.test(meanings)) addWords(vocabulary.join(" "));
  }
  for (const index of vocabularyIndexesForRoles(semanticRoles)) {
    const vocabulary = ENGLISH_SEMANTIC_VOCABULARY[index]?.[1];
    if (vocabulary !== undefined) addWords(vocabulary.join(" "));
  }
  const shellWords = shell
    .toLocaleLowerCase("en-US")
    .match(/\p{L}+(?:-\p{L}+)*/gu) ?? [];
  return shellWords.every((token) =>
    token.length <= 2 ||
    SAFE_UPPERCASE_TERMS.has(token.toLocaleUpperCase("en-US")) ||
    allowed.has(englishStem(token))
  );
}

function azerbaijaniShellVocabularyIsSupported(
  shell: string,
  meanings: string,
  semanticRoles: ReadonlySet<RenderableSemanticRole>
): boolean {
  const roots: string[] = [...SAFE_AZERBAIJANI_SHELL_ROOTS];
  for (const [supportedBy, vocabulary] of AZERBAIJANI_SEMANTIC_VOCABULARY) {
    if (supportedBy.test(meanings)) roots.push(...vocabulary);
  }
  for (const index of vocabularyIndexesForRoles(semanticRoles)) {
    const vocabulary = AZERBAIJANI_SEMANTIC_VOCABULARY[index]?.[1];
    if (vocabulary !== undefined) roots.push(...vocabulary);
  }
  if ([...semanticRoles].some((role) => role.startsWith("activity."))) {
    roots.push("aktivlik", "əməliyyat", "ticarət", "tarixçə");
  }
  const shellWords = shell
    .replaceAll("İ", "i")
    .toLocaleLowerCase("az-AZ")
    .match(/\p{L}+/gu) ?? [];
  return shellWords.every((token) =>
    token.length <= 1 ||
    SAFE_UPPERCASE_TERMS.has(token.toLocaleUpperCase("en-US")) ||
    roots.some((root) => token.startsWith(root))
  );
}

function semanticShellIsSupported(
  draft: ClaimDraft,
  facts: ReadonlyMap<string, RenderableFact>,
  citations: ReadonlyMap<string, RenderableCitation>,
  onReject?: (reason: string) => void
): boolean {
  const shell = draft.textTemplate.replace(PLACEHOLDER, " ");
  const semanticReject = (reason: string): false => {
    onReject?.(reason);
    return false;
  };
  if (UNSUPPORTED_CONCLUSION.test(shell)) {
    return semanticReject("unsupported_conclusion");
  }
  if (NUMBER_WORD.test(shell)) {
    return semanticReject("number_word");
  }
  if (!templateLanguageMatches(shell, draft.locale)) {
    return semanticReject("language");
  }
  const unexpectedUppercase = shell.match(/\b[A-Z]{2,5}\b/gu) ?? [];
  if (unexpectedUppercase.some((token) => !SAFE_UPPERCASE_TERMS.has(token))) {
    return semanticReject(`uppercase_${unexpectedUppercase.join("_")}`);
  }
  const meanings = draft.factRefs
    .map((ref) => facts.get(ref)?.meaning ?? "")
    .join(" ");
  const semanticRoles = new Set(
    draft.factRefs.flatMap((ref) => [...(facts.get(ref)?.semanticRoles ?? [])])
  );
  if (
    draft.locale === "en-US" &&
    !englishShellVocabularyIsSupported(shell, meanings, semanticRoles)
  ) {
    return semanticReject("unsupported_vocabulary");
  }
  if (
    draft.locale === "az-AZ" &&
    !azerbaijaniShellVocabularyIsSupported(shell, meanings, semanticRoles)
  ) {
    return semanticReject("unsupported_vocabulary");
  }
  for (const [term, supportedRoles] of MATERIAL_TERMS) {
    if (
      term.test(shell) &&
      !supportedRoles.some((role) => semanticRoles.has(role))
    ) {
      return semanticReject(`unsupported_material_${String(term)}`);
    }
  }
  // A citation marker alone is not enough to support free-standing factual
  // prose; material content must still come through a fact placeholder.
  const supported = draft.factRefs.length > 0 || (
    draft.citationRefs.length > 0 &&
    draft.citationRefs.every((ref) => citations.has(ref)) &&
    shell.replace(/\s+/gu, " ").trim().length <= 32
  );
  return supported || semanticReject("no_fact_support");
}

function boundedSemanticRejectionReason(
  reason: string | null
): WriterDraftRejectionReason {
  if (reason === "unsupported_conclusion") {
    return "claim_semantics_unsupported_conclusion";
  }
  if (reason === "number_word") return "claim_semantics_number_word";
  if (reason === "language") return "claim_semantics_language";
  if (reason?.startsWith("uppercase_")) return "claim_semantics_uppercase";
  if (reason === "unsupported_vocabulary") {
    return "claim_semantics_unsupported_vocabulary";
  }
  if (reason?.startsWith("unsupported_material_")) {
    return "claim_semantics_unsupported_material";
  }
  if (reason === "no_fact_support") {
    return "claim_semantics_no_fact_support";
  }
  return "claim_semantics";
}

function semanticTermsSupportedBy(
  shell: string,
  semanticRoleSets: readonly (readonly RenderableSemanticRole[])[]
): boolean {
  if (shell.trim() === "") return true;
  for (const [term, supportedRoles] of MATERIAL_TERMS) {
    if (
      term.test(shell) &&
      (
        semanticRoleSets.length === 0 ||
        semanticRoleSets.some((roles) =>
          !supportedRoles.some((role) => roles.includes(role))
        )
      )
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Binds material words to the adjacent signed slot instead of validating them
 * against the union of all meanings in a claim. This prevents a fluent shell
 * from swapping roles such as price/change or fees/income while preserving
 * value-free connective prose.
 */
function locallyBoundSemanticShellIsSupported(
  draft: ClaimDraft,
  facts: ReadonlyMap<string, RenderableFact>
): boolean {
  const pieces = draft.textTemplate.split(/(\{\{[A-Z][A-Z0-9_-]{0,31}\}\})/gu);
  const aliasAt = (index: number, direction: -1 | 1): string | null => {
    for (
      let cursor = index + direction;
      cursor >= 0 && cursor < pieces.length;
      cursor += direction
    ) {
      const match = pieces[cursor]?.match(
        /^\{\{([A-Z][A-Z0-9_-]{0,31})\}\}$/u
      );
      if (match?.[1] && facts.has(match[1])) return match[1];
    }
    return null;
  };

  for (let index = 0; index < pieces.length; index += 2) {
    const shell = pieces[index] ?? "";
    if (shell.trim() === "") continue;
    const previousAlias = aliasAt(index, -1);
    const nextAlias = aliasAt(index, 1);
    const previousRoles = previousAlias === null
      ? null
      : facts.get(previousAlias)?.semanticRoles ?? null;
    const nextRoles = nextAlias === null
      ? null
      : facts.get(nextAlias)?.semanticRoles ?? null;

    const boundary = Math.max(
      shell.lastIndexOf("."),
      shell.lastIndexOf("!"),
      shell.lastIndexOf("?")
    );
    if (boundary >= 0) {
      const before = shell.slice(0, boundary + 1);
      const after = shell.slice(boundary + 1);
      if (
        !semanticTermsSupportedBy(
          before,
          previousRoles === null ? [] : [previousRoles]
        ) ||
        !semanticTermsSupportedBy(
          after,
          nextRoles === null ? [] : [nextRoles]
        )
      ) {
        return false;
      }
      continue;
    }

    const normalized = shell
      .trim()
      .toLocaleLowerCase(draft.locale === "az-AZ" ? "az-AZ" : "en-US");
    const azDescribesPrevious = draft.locale === "az-AZ" &&
      AZERBAIJANI_PREVIOUS_SLOT_COPULA.test(normalized);
    const azIntroducesNext = draft.locale === "az-AZ" &&
      !azDescribesPrevious &&
      AZERBAIJANI_MATERIAL_LABEL_AT_END.test(normalized);
    const introducesNext = azIntroducesNext ||
      /(?:\b(?:is|are|was|were|equals?|at|in|of|for|to)|:)\s*$/iu.test(normalized);
    const describesPrevious = azDescribesPrevious ||
      /^(?:[,;]\s*)?(?:which|that|versus|from|compared|against|with)\b/iu
        .test(normalized);
    const selectedRoles = introducesNext && nextRoles !== null
      ? [nextRoles]
      : describesPrevious && previousRoles !== null
        ? [previousRoles]
        : [previousRoles, nextRoles].filter(
            (roles): roles is readonly RenderableSemanticRole[] => roles !== null
          );
    if (!semanticTermsSupportedBy(shell, selectedRoles)) return false;
  }
  return true;
}

function citationPairingIsValid(
  templateRefs: readonly string[],
  facts: ReadonlyMap<string, RenderableFact>,
  citations: ReadonlyMap<string, RenderableCitation>
): boolean {
  const requiredCitationAliases = new Set(
    [...facts.values()].flatMap(({ requiredCitationAlias }) =>
      requiredCitationAlias === undefined ? [] : [requiredCitationAlias]
    )
  );
  if (requiredCitationAliases.size === 0) return true;
  for (const alias of requiredCitationAliases) {
    if (!citations.has(alias)) return false;
  }

  let pendingCitation: string | null = null;
  for (const alias of templateRefs) {
    const fact = facts.get(alias);
    if (fact?.requiredCitationAlias !== undefined) {
      if (
        pendingCitation !== null &&
        pendingCitation !== fact.requiredCitationAlias
      ) {
        return false;
      }
      pendingCitation = fact.requiredCitationAlias;
      continue;
    }
    if (!citations.has(alias) || !requiredCitationAliases.has(alias)) continue;
    if (pendingCitation !== alias) return false;
    pendingCitation = null;
  }
  return pendingCitation === null;
}

function conversationalShapeIsSafe(message: string): boolean {
  const words = message.match(/[\p{L}\p{N}]+(?:['’_-][\p{L}\p{N}]+)*/gu) ?? [];
  const sentences = message
    .replace(/([\p{N}])\.(?=[\p{N}])/gu, "$1")
    .split(/[.!?]+/gu)
    .map((part) => part.trim())
    .filter(Boolean);
  return message.length <= 900 &&
    words.length <= 140 &&
    sentences.length <= 5 &&
    !/```|^\s*#{1,6}\s|\b(?:toolExecutionIds|workflowRunId|read-market-snapshot)\b/imu
      .test(message);
}

/**
 * Replaces placeholders only after verifying each signed fact and its complete
 * tool/fact ancestry. Invalid writer output never reaches the customer.
 */
export function renderClaimDrafts(input: {
  drafts: readonly ClaimDraft[];
  facts: readonly RenderableFact[];
  citations: readonly RenderableCitation[];
  tools: readonly ToolExecutionEnvelope<unknown>[];
  inputFacts?: readonly FactEnvelope<unknown>[];
  evidence: EvidenceFactory;
  fallback: ClaimDraft[];
  locale: SupportedLocale;
  /**
   * Optional bounded diagnostic hook. It reports only a reviewed reason code,
   * never model prose, evidence values, aliases, or user content.
   */
  onWriterRejected?: (reason: WriterDraftRejectionReason) => void;
}): RenderedClaims {
  const attempt = render(input.drafts, input, false, (reason) => {
    const code = reason.split(":", 1)[0] as WriterDraftRejectionReason;
    if ((WRITER_DRAFT_REJECTION_REASONS as readonly string[]).includes(code)) {
      input.onWriterRejected?.(code);
    }
  });
  if (attempt) {
    return { ...attempt, generationMode: "writer" };
  }
  const fallback = render(input.fallback, input, true);
  if (!fallback) {
    throw new Error("Deterministic response template failed its own grounding gate.");
  }
  return { ...fallback, generationMode: "deterministic-fallback" };
}

function render(
  drafts: readonly ClaimDraft[],
  input: {
    facts: readonly RenderableFact[];
    citations: readonly RenderableCitation[];
    tools: readonly ToolExecutionEnvelope<unknown>[];
    inputFacts?: readonly FactEnvelope<unknown>[];
    evidence: EvidenceFactory;
    locale: SupportedLocale;
  },
  trustedFallback: boolean,
  onReject?: (reason: string) => void
): Omit<RenderedClaims, "generationMode"> | null {
  const reject = (reason: string): null => {
    onReject?.(reason);
    return null;
  };
  if (drafts.length === 0 || drafts.length > 5) return reject("draft_count");
  const facts = new Map(input.facts.map((item) => [item.alias, item]));
  const citations = new Map(input.citations.map((item) => [item.alias, item]));
  const allAliases = [...facts.keys(), ...citations.keys()];
  if (
    facts.size !== input.facts.length ||
    citations.size !== input.citations.length ||
    new Set(allAliases).size !== allAliases.length
  ) {
    return reject("alias_conflict");
  }
  if (
    new Set(drafts.map(({ claimId }) => claimId)).size !== drafts.length
  ) {
    return reject("claim_id_conflict");
  }
  const usedFactAliases = new Set<string>();
  const usedFactIds = new Set<string>();
  const usedCitationAliases = new Set<string>();
  const usedCitationIds = new Set<string>();
  const normalizedClaims: ClaimDraft[] = [];
  const messages: string[] = [];

  for (const draft of drafts) {
    if (draft.locale !== input.locale) {
      return reject(`claim_locale:${draft.claimId}`);
    }
    if (draft.limitations.length > 0) {
      return reject(`claim_limitations:${draft.claimId}`);
    }
    if (containsUngroundedExactValue(draft.textTemplate)) {
      return reject(`claim_exact_value:${draft.claimId}`);
    }
    let semanticReason: string | null = null;
    if (
      !trustedFallback &&
      !semanticShellIsSupported(
        draft,
        facts,
        citations,
        (reason) => {
          semanticReason = reason;
        }
      )
    ) {
      const boundedReason = boundedSemanticRejectionReason(semanticReason);
      return reject(`${boundedReason}:${draft.claimId}`);
    }
    if (
      !trustedFallback &&
      !locallyBoundSemanticShellIsSupported(draft, facts)
    ) {
      return reject(`claim_local_semantics:${draft.claimId}`);
    }
    const templateRefs = referencesIn(draft.textTemplate);
    const declaredRefs = new Set([...draft.factRefs, ...draft.citationRefs]);
    if (
      templateRefs.length === 0 ||
      new Set(templateRefs).size !== templateRefs.length ||
      templateRefs.some((ref) => !declaredRefs.has(ref)) ||
      [...declaredRefs].some((ref) => !templateRefs.includes(ref)) ||
      !citationPairingIsValid(templateRefs, facts, citations)
    ) {
      return reject(`claim_references:${draft.claimId}`);
    }

    let message = draft.textTemplate;
    const normalizedFactRefs = new Set<string>();
    for (const alias of draft.factRefs) {
      const renderable = facts.get(alias);
      if (!renderable || !normalizeSentence(renderable.display)) {
        return reject(`fact_display_missing:${alias}`);
      }
      if (!verifyRenderableFactProjection(renderable, input.evidence)) {
        return reject(`fact_projection_invalid:${alias}`);
      }
      if (!input.evidence.verifyFact(
        renderable.fact,
        input.tools,
        input.inputFacts ?? []
      )) return reject(`fact_envelope_invalid:${alias}`);
      message = message.replaceAll(`{{${alias}}}`, normalizeSentence(renderable.display));
      normalizedFactRefs.add(renderable.fact.factId);
      usedFactAliases.add(alias);
      usedFactIds.add(renderable.fact.factId);
    }

    const normalizedCitationRefs = new Set<string>();
    const citationAliasesByFirstUse = templateRefs.filter((alias, index) =>
      draft.citationRefs.includes(alias) &&
      templateRefs.indexOf(alias) === index
    );
    for (const alias of citationAliasesByFirstUse) {
      const renderable = citations.get(alias);
      if (!renderable) return reject(`citation_missing:${alias}`);
      if (!usedCitationIds.has(renderable.citation.citationId)) {
        usedCitationIds.add(renderable.citation.citationId);
      }
      const citationIndex = [...usedCitationIds].indexOf(renderable.citation.citationId) + 1;
      message = message.replaceAll(`{{${alias}}}`, `[${citationIndex}]`);
      normalizedCitationRefs.add(renderable.citation.citationId);
      usedCitationAliases.add(alias);
    }
    if (referencesIn(message).length > 0) {
      return reject(`claim_placeholder_remaining:${draft.claimId}`);
    }

    const normalizedMessage = normalizeSentence(message);
    if (!normalizedMessage) return reject(`claim_message_empty:${draft.claimId}`);
    messages.push(normalizedMessage);
    normalizedClaims.push({
      ...draft,
      textTemplate: draft.textTemplate,
      factRefs: [...normalizedFactRefs],
      citationRefs: [...normalizedCitationRefs]
    });
  }

  const message = messages.join(" ");
  if (!conversationalShapeIsSafe(message)) return reject("conversation_shape");
  return {
    message,
    claims: normalizedClaims,
    usedFactAliases: [...usedFactAliases],
    usedFactIds: [...usedFactIds],
    usedCitationAliases: [...usedCitationAliases],
    usedCitationIds: [...usedCitationIds]
  };
}
