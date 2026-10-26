// run-desktop.mjs — the bench in a fresh headless Chrome (its own profile; puppeteer closes only it).
import puppeteer from "puppeteer-core"; import { mkdtempSync } from "node:fs"; import { tmpdir } from "node:os"; import path from "node:path";
import { serve } from "./serve.mjs";
const srv = serve(4198);
const browser = await puppeteer.launch({ headless: true, executablePath: process.env.CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe", userDataDir: mkdtempSync(path.join(tmpdir(), "dfbench-")) });
try {
  const page = await browser.newPage();
  await page.goto("http://127.0.0.1:4198/index.html");
  await page.waitForFunction(() => window.result, { timeout: 180000 });
  console.log(JSON.stringify(await page.evaluate(() => window.result), null, 1));
} finally { await browser.close(); srv.close(); }
