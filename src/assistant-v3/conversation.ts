import type { SupportedLocale } from "./contracts.js";

export const V3_CONVERSATIONAL_TURN_KINDS = [
  "greeting",
  "gratitude",
  "capability_overview",
  "simplify_follow_up"
] as const;

export type V3ConversationalTurnKind =
  (typeof V3_CONVERSATIONAL_TURN_KINDS)[number];

export interface ReviewedConversationStatement {
  readonly alias: string;
  readonly meaning: string;
  readonly text: string;
  readonly required: true;
}

export interface ReviewedConversationDefinition {
  readonly catalogVersion: "assistant-conversation-v1";
  readonly kind: V3ConversationalTurnKind;
  readonly locale: SupportedLocale;
  readonly statements: readonly ReviewedConversationStatement[];
  readonly answer: string;
}

export interface ReviewedGenericClarificationDefinition {
  readonly catalogVersion: "assistant-generic-clarification-v1";
  readonly kind: "generic_clarification";
  readonly locale: SupportedLocale;
  readonly statements: readonly ReviewedConversationStatement[];
  readonly answer: string;
}

function normalizedTurn(message: string): string {
  return message
    .normalize("NFKC")
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase("en-US");
}

/**
 * Deliberately narrow no-tool classifier. It accepts social turns and an
 * explicit request to simplify the previous explanation, but never a mixed
 * factual request such as "thanks, what is NVDA trading at?".
 */
export function classifyV3ConversationalTurn(
  message: string
): V3ConversationalTurnKind | null {
  const normalized = normalizedTurn(message);
  if (
    /^(?:(?:hello|hi|hey|good\s+(?:morning|afternoon|evening))|(?:salam(?:lar)?|sabah(?:ınız|iniz)\s+xeyir|axşam(?:ınız|iniz)\s+xeyir))(?:[,.!?\s]+(?:(?:how\s+are\s+you)|(?:necəsən|necesen)))?[.!?\s]*$/iu
      .test(normalized)
  ) {
    return "greeting";
  }
  if (
    /^(?:(?:ok(?:ay)?|got\s+it|perfect|great|that\s+makes\s+sense)[,\s]+)?(?:thanks|thank\s+you|many\s+thanks)(?:[,\s]+(?:that\s+(?:helped|helps)|very\s+helpful|for\s+that))?[.!?\s]*$|^(?:i\s+appreciate\s+it|appreciate\s+it)[.!?\s]*$|^(?:(?:aydındır|aydindir|başa\s+düşdüm|basa\s+dusdum)[,\s]+)?(?:(?:çox|cox)\s+)?(?:sağ\s+ol|sag\s+ol|təşəkkür(?:lər|\s+edirəm)|tesekkur(?:ler|\s+edirem))(?:[,\s]+(?:kömək|komek)\s+(?:oldu|etdi))?[.!?\s]*$/iu
      .test(normalized)
  ) {
    return "gratitude";
  }
  if (
    /^(?:(?:hello|hi|hey|salam(?:lar)?)[,.!?\s]+)?(?:what\s+can\s+you\s+(?:do|help(?:\s+me)?\s+with)|how\s+can\s+you\s+help(?:\s+me)?|what\s+do\s+you\s+(?:support|help\s+with)|tell\s+me\s+what\s+you\s+can\s+do)[.!?\s]*$|^(?:(?:salam(?:lar)?)[,.!?\s]+)?(?:nə|ne)\s+ed[əe]\s+bil[əe]rs[əe]n[.!?\s]*$|^(?:(?:salam(?:lar)?)[,.!?\s]+)?(?:mənə|mene)\s+(?:necə|nece|nələrdə|nelerde)\s+(?:kömək|komek)\s+ed[əe]\s+bil[əe]rs[əe]n[.!?\s]*$|^(?:(?:salam(?:lar)?)[,.!?\s]+)?(?:hansı|hansi)\s+suallarda\s+(?:kömək|komek)\s+ed[əe]\s+bil[əe]rs[əe]n[.!?\s]*$/iu
      .test(normalized)
  ) {
    return "capability_overview";
  }
  if (
    /^(?:(?:can|could|would)\s+you\s+)?(?:(?:explain|say|put|rewrite)\s+(?:that|it|this)|(?:make|keep)\s+(?:that|it|this))\s+(?:(?:a\s+bit\s+)?(?:more\s+)?(?:simple|simply|plain|brief|shorter)|in\s+plain\s+english)(?:\s+(?:please))?[.!?\s]*$|^(?:(?:bunu|onu)\s+)?(?:(?:daha\s+)?(?:sadə|sade|qısa|qisa)\s+(?:izah\s+et|de|yaz)|(?:sadə|sade)\s+dillə\s+(?:izah\s+et|de|yaz))(?:\s+(?:zəhmət\s+olmasa|zehmet\s+olmasa))?[.!?\s]*$/iu
      .test(normalized)
  ) {
    return "simplify_follow_up";
  }
  return null;
}

const DEFINITIONS: Readonly<
  Record<
    SupportedLocale,
    Readonly<Record<V3ConversationalTurnKind, readonly ReviewedConversationStatement[]>>
  >
> = {
  "en-US": {
    greeting: [{
      alias: "CONVERSATION_SCOPE",
      meaning: "the assistant is available for portfolio, public-market, and investment-education questions",
      text: "portfolio, public-market, and investment-education questions",
      required: true
    }],
    gratitude: [{
      alias: "CONVERSATION_CONTINUATION",
      meaning: "the assistant remains available for the user's next investment question",
      text: "send your next investment question whenever you’re ready",
      required: true
    }],
    capability_overview: [
      {
        alias: "CONVERSATION_CAPABILITIES",
        meaning: "the reviewed assistant capability scope",
        text: "mock-portfolio insights, current public-market research, reviewed investment education, and read-only order-ticket previews",
        required: true
      },
      {
        alias: "CONVERSATION_BOUNDARY",
        meaning: "the assistant cannot execute trades or make personal investment decisions",
        text: "I cannot execute trades or make personal buy, sell, or hold decisions",
        required: true
      }
    ],
    simplify_follow_up: [
      {
        alias: "CONVERSATION_STYLE",
        meaning: "the assistant can use a shorter plain-language explanation",
        text: "a shorter, plain-language explanation",
        required: true
      },
      {
        alias: "CONVERSATION_TARGET",
        meaning: "the user should identify or paste the part to simplify",
        text: "the sentence or section you want simplified",
        required: true
      }
    ]
  },
  "az-AZ": {
    greeting: [{
      alias: "CONVERSATION_SCOPE",
      meaning: "köməkçinin portfel, açıq bazar və investisiya təhsili sualları üçün hazır olması",
      text: "portfel, açıq bazar və investisiya təhsili sualları",
      required: true
    }],
    gratitude: [{
      alias: "CONVERSATION_CONTINUATION",
      meaning: "köməkçinin istifadəçinin növbəti investisiya sualı üçün hazır qalması",
      text: "hazır olduqda növbəti investisiya sualınızı göndərin",
      required: true
    }],
    capability_overview: [
      {
        alias: "CONVERSATION_CAPABILITIES",
        meaning: "köməkçinin yoxlanılmış imkan dairəsi",
        text: "demo portfel üzrə izahlar, cari açıq bazar araşdırması, yoxlanılmış investisiya təhsili və yalnız oxuma rejimli sifariş bileti önbaxışları",
        required: true
      },
      {
        alias: "CONVERSATION_BOUNDARY",
        meaning: "köməkçinin əməliyyat icra edə və fərdi investisiya qərarı verə bilməməsi",
        text: "əməliyyat icra edə və sizin üçün fərdi al, sat və ya saxla qərarı verə bilmərəm",
        required: true
      }
    ],
    simplify_follow_up: [
      {
        alias: "CONVERSATION_STYLE",
        meaning: "köməkçinin daha qısa və sadə dildə izah verə bilməsi",
        text: "daha qısa və sadə dildə izah",
        required: true
      },
      {
        alias: "CONVERSATION_TARGET",
        meaning: "istifadəçinin sadələşdiriləcək cümləni və ya hissəni bildirməsi",
        text: "sadələşdirməyimi istədiyiniz cümlə və ya hissə",
        required: true
      }
    ]
  }
};

const GENERIC_CLARIFICATION_DEFINITIONS: Readonly<
  Record<SupportedLocale, readonly ReviewedConversationStatement[]>
> = {
  "en-US": [
    {
      alias: "CLARIFICATION_REQUEST",
      meaning: "a request for the user to say a little more about what they want checked",
      text: "tell me a little more about what you’d like me to check",
      required: true
    },
    {
      alias: "CLARIFICATION_SCOPE",
      meaning: "reviewed examples of supported questions: portfolio value, performance, fees, or a named ticker's price or analysis",
      text: "portfolio value, performance, fees, or a named ticker’s price or analysis",
      required: true
    }
  ],
  "az-AZ": [
    {
      alias: "CLARIFICATION_REQUEST",
      meaning: "istifadəçidən nəyə baxılmasını istədiyini bir az daha dəqiq deməsini xahiş etmək",
      text: "nəyə baxmağımı istədiyinizi bir az daha dəqiq deyin",
      required: true
    },
    {
      alias: "CLARIFICATION_SCOPE",
      meaning: "dəstəklənən suallar üçün yoxlanılmış nümunələr: portfel dəyəri, nəticələr, komissiyalar və ya konkret ticker üzrə qiymət və təhlil",
      text: "portfel dəyəri, nəticələr, komissiyalar və ya konkret ticker üzrə qiymət və təhlil soruşa bilərsiniz",
      required: true
    }
  ]
};

/**
 * The router, rather than free-form text classification, selects this catalog
 * only after it has safely concluded that no deterministic capability route
 * matches. Other clarification and boundary responses remain deterministic.
 */
export function reviewedGenericClarificationDefinition(
  locale: SupportedLocale
): ReviewedGenericClarificationDefinition {
  const statements = GENERIC_CLARIFICATION_DEFINITIONS[locale];
  return Object.freeze({
    catalogVersion: "assistant-generic-clarification-v1" as const,
    kind: "generic_clarification" as const,
    locale,
    statements: Object.freeze(statements.map((statement) =>
      Object.freeze({ ...statement })
    )),
    answer: locale === "az-AZ"
      ? "{{CLARIFICATION_REQUEST}}. Məsələn, {{CLARIFICATION_SCOPE}}."
      : "Could you {{CLARIFICATION_REQUEST}}? I can help with {{CLARIFICATION_SCOPE}}."
  });
}

export function isReviewedGenericClarificationDefinition(
  value: unknown,
  locale: SupportedLocale
): value is ReviewedGenericClarificationDefinition {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  const expected = reviewedGenericClarificationDefinition(locale);
  return record.catalogVersion === expected.catalogVersion &&
    record.kind === expected.kind &&
    record.locale === locale &&
    record.answer === expected.answer &&
    Array.isArray(record.statements) &&
    JSON.stringify(record.statements) === JSON.stringify(expected.statements);
}

function fallbackTemplate(
  kind: V3ConversationalTurnKind,
  locale: SupportedLocale
): string {
  if (locale === "az-AZ") {
    switch (kind) {
      case "greeting":
        return "Salam! {{CONVERSATION_SCOPE}} ilə bağlı sizə necə kömək edə bilərəm?";
      case "gratitude":
        return "Buyurun — {{CONVERSATION_CONTINUATION}}.";
      case "capability_overview":
        return "{{CONVERSATION_CAPABILITIES}} üzrə kömək edə bilərəm. {{CONVERSATION_BOUNDARY}}.";
      case "simplify_follow_up":
        return "Əlbəttə, {{CONVERSATION_STYLE}} verə bilərəm. {{CONVERSATION_TARGET}}-ni göndərin.";
    }
  }
  switch (kind) {
    case "greeting":
      return "Hi! How can I help with {{CONVERSATION_SCOPE}}?";
    case "gratitude":
      return "You’re welcome—{{CONVERSATION_CONTINUATION}}.";
    case "capability_overview":
      return "I can help with {{CONVERSATION_CAPABILITIES}}. {{CONVERSATION_BOUNDARY}}.";
    case "simplify_follow_up":
      return "Of course—I can give {{CONVERSATION_STYLE}}. Send me {{CONVERSATION_TARGET}}.";
  }
}

export function reviewedConversationDefinition(
  message: string,
  locale: SupportedLocale
): ReviewedConversationDefinition | null {
  const kind = classifyV3ConversationalTurn(message);
  if (kind === null) return null;
  const statements = DEFINITIONS[locale][kind];
  return Object.freeze({
    catalogVersion: "assistant-conversation-v1" as const,
    kind,
    locale,
    statements: Object.freeze(statements.map((statement) =>
      Object.freeze({ ...statement })
    )),
    answer: fallbackTemplate(kind, locale)
  });
}

export function renderReviewedConversationAnswer(
  definition: ReviewedConversationDefinition
): string {
  return definition.statements.reduce(
    (answer, statement) =>
      answer.replaceAll(`{{${statement.alias}}}`, statement.text),
    definition.answer
  );
}

export function isReviewedConversationDefinition(
  value: unknown,
  locale: SupportedLocale
): value is ReviewedConversationDefinition {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (
    record.catalogVersion !== "assistant-conversation-v1" ||
    record.locale !== locale ||
    typeof record.kind !== "string" ||
    !(V3_CONVERSATIONAL_TURN_KINDS as readonly string[]).includes(record.kind) ||
    typeof record.answer !== "string" ||
    !Array.isArray(record.statements)
  ) {
    return false;
  }
  const expected = DEFINITIONS[locale][record.kind as V3ConversationalTurnKind];
  return JSON.stringify(record.statements) === JSON.stringify(expected) &&
    record.answer === fallbackTemplate(
      record.kind as V3ConversationalTurnKind,
      locale
    );
}

function localeMatches(text: string, locale: SupportedLocale): boolean {
  const azSignal =
    /[əğıöşüçİ]|(?<!\p{L})(?:üçün|ilə|kömək|komek|sadə|sade|qısa|qisa|buyurun|sualınız|sualiniz|bilərəm|bilerem)(?!\p{L})/u;
  return locale === "az-AZ" ? azSignal.test(text) : !azSignal.test(text);
}

/**
 * Studio may keep its model-authored social reply only when it remains a
 * short, claim-free response for the deterministically classified speech act.
 */
export function safeStudioConversationalReply(input: {
  readonly message: string;
  readonly locale: SupportedLocale;
  readonly modelText: string;
}): string | null {
  const kind = classifyV3ConversationalTurn(input.message);
  if (kind === null) return null;
  const text = input.modelText
    .normalize("NFKC")
    .replace(/\s+/gu, " ")
    .trim();
  const words = text.match(/\p{L}+(?:['’_-]\p{L}+)*/gu) ?? [];
  const sentences = text.split(/[.!?]+/gu).map((part) => part.trim()).filter(Boolean);
  const actionLanguage =
    /\b(?:buy|sell|hold|recommend|advice|submit|execute|place\s+an?\s+order)\b|(?<!\p{L})(?:al|sat|saxla|tövsiyə|tovsiye|məsləhət|meslehet|icra\s+et)(?!\p{L})/iu;
  const unsupportedCapability =
    /\b(?:i|we)\s+(?:can|will)\s+(?:buy|sell|hold|recommend|submit|execute|place)\b|(?<!\p{L})(?:ala|sata|icra\s+edə|icra\s+ede)\s+bilərəm(?!\p{L})/iu;
  if (
    text.length === 0 ||
    text.length > 420 ||
    words.length > 70 ||
    sentences.length > 3 ||
    /[\d$€£₼%]|https?:\/\/|```|^\s*#/iu.test(text) ||
    /\b(?:price|quote|return|performance|fee|tariff|yield|rating|target|balance|holding|current\s+value)\b|(?<!\p{L})(?:qiymət|qiymet|gəlir|gelir|zərər|zerer|komissiya|tarif|balans|cari\s+dəyər)(?!\p{L})/iu
      .test(text) ||
    (
      kind === "capability_overview"
        ? unsupportedCapability.test(text)
        : actionLanguage.test(text)
    ) ||
    /\b(?:system\s+prompt|workflow|tool|grounding|deterministic)\b/iu.test(text) ||
    !localeMatches(text, input.locale)
  ) {
    return null;
  }
  const kindSignal = kind === "greeting"
    ? /^(?:hello|hi|hey|salam)|\b(?:welcome|xoş\s+gördük|xos\s+gorduk)\b/iu
    : kind === "gratitude"
      ? /\b(?:welcome|glad|happy|anytime|buyurun|dəyməz|deymez|sevindim)\b/iu
      : kind === "capability_overview"
        ? /\b(?:help|explain|research|portfolio|market|investment|education|kömək|komek|izah|araşdır|bazar|portfel|investisiya|təhsil|tehsil)\b/iu
        : /\b(?:simple|plain|short|shorter|rephrase|rewrite|sadə|sade|qısa|qisa|yenidən|yeniden)\b/iu;
  return kindSignal.test(text) ? text : null;
}
