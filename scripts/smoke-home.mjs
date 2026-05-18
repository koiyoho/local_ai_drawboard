import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const baseUrl = process.env.SMOKE_BASE_URL ?? "http://localhost:3010";
await page.goto(baseUrl, {
  waitUntil: "domcontentloaded",
  timeout: 30000,
});
await page.screenshot({ path: "tmp/home.png", fullPage: true });
const title = await page.locator("h1").first().textContent();
await browser.close();

console.log(`home h1: ${title}`);
