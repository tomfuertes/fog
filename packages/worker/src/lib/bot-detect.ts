// KEY-DECISION 2025-02-21: Detect bots via UA only. CF bot management requires
// Enterprise. We filter bots from analytics, NOT from variant assignment (cloaking).

const BOT_UA_PATTERN = /bot|crawler|spider|scraper|googlebot|bingbot|slurp|duckduckbot|baiduspider|yandexbot|facebookexternalhit|twitterbot|linkedinbot|whatsapp|telegrambot|gptbot|claude-web|anthropic|ccbot|google-extended|perplexitybot|applebot|amazonbot|bytespider/i;

export function isBot(request: Request): boolean {
  const ua = request.headers.get("User-Agent") ?? "";
  return BOT_UA_PATTERN.test(ua);
}
