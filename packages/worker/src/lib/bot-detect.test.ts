import { describe, it, expect } from "vitest";
import { isBot } from "./bot-detect";

function req(ua: string): Request {
  return new Request("https://example.com", { headers: { "User-Agent": ua } });
}

describe("isBot", () => {
  it("detects Googlebot", () => {
    expect(isBot(req("Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"))).toBe(true);
  });

  it("detects Bingbot", () => {
    expect(isBot(req("Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)"))).toBe(true);
  });

  it("detects GPTBot", () => {
    expect(isBot(req("Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.0"))).toBe(true);
  });

  it("detects generic bot substring", () => {
    expect(isBot(req("SomeRandomBot/1.0"))).toBe(true);
  });

  it("detects crawler substring", () => {
    expect(isBot(req("MyCrawler/2.0"))).toBe(true);
  });

  it("allows Chrome desktop", () => {
    expect(isBot(req("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"))).toBe(false);
  });

  it("allows Safari mobile", () => {
    expect(isBot(req("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"))).toBe(false);
  });

  it("allows Firefox", () => {
    expect(isBot(req("Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0"))).toBe(false);
  });

  it("treats empty UA as not-bot", () => {
    expect(isBot(req(""))).toBe(false);
  });

  it("treats missing UA as not-bot", () => {
    expect(isBot(new Request("https://example.com"))).toBe(false);
  });
});
