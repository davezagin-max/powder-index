#!/usr/bin/env node
/**
 * Functional check for Powder Index: every feature in the brief and the README's
 * "What it does" list, driven in headless Chromium at 1280x800 and 390x844, in light
 * and dark themes.
 *
 *   pnpm build && pnpm exec next start -p 3140     # the production server must already be running on port 3140
 *   pnpm functional
 *
 * Every action asserts a visible outcome: text, an element's state, the URL, or a
 * response. The run fails on any console error or uncaught page error, and on any
 * sideways scroll of the page after an interaction. Two things are reported rather than
 * failed: the request for the published manifest on GitHub Pages (a 404 until Pages is
 * enabled, which the page handles by keeping its bundled data), and the dbt docs link,
 * which is reported as BLOCKED for the same reason.
 *
 * The Ask panel runs in demo mode with no key: each preset's bundled SQL is executed in
 * DuckDB-WASM. The live path is driven with a made-up key on this local host and with
 * /api/ask answered by a route stub, so no request reaches Claude.
 *
 * Exit status: 0 when every check passes, 1 when a check fails, 2 when the server is not
 * answering on port 3140.
 */
import { readFileSync, readdirSync } from "node:fs";
import { chromium } from "playwright";

const root = new URL("../", import.meta.url);
const read = (relative) => JSON.parse(readFileSync(new URL(relative, root), "utf8"));

const BASE = "http://localhost:3140";
const bundled = read("public/data/dashboard.json");
const schema = read("public/data/schema.json");
const fixtures = read("fixtures/ask.json");
const PRESETS = read("fixtures/presets.json").map((preset) => ({
  id: preset.body.demoId,
  question: preset.body.question,
}));
const RESORTS = bundled.resorts;
const DATES = bundled.dates;
const LATEST = DATES.at(-1);
const FIRST = DATES[0];
const BEST = bundled.bestDays[0].date;
const SECOND_BEST = bundled.bestDays[1].date;
const INTRO_QUESTION = PRESETS.find((p) => p.id === "season-totals").question;
const TRAIL_PRESET = PRESETS.find((p) => (fixtures[p.id]?.data.trail ?? []).length > 0);
const LINE_PRESET = PRESETS.find((p) => fixtures[p.id]?.data.chart?.type === "line" && fixtures[p.id]?.data.chart?.series);
const SEASON_TEMPLATE = fixtures["season-totals"].data;
const TEST_KEY = "sk-ant-test-local-0000000000000000";
const BAD_SQL = "SELECT no_such_column FROM resort_daily LIMIT 5";
const REPO_URL = "https://github.com/davezagin-max/powder-index";
const DOCS_URL = "https://davezagin-max.github.io/powder-index/docs/";
const MANIFEST_URL = "https://davezagin-max.github.io/powder-index/data/manifest.json";
const PAGES_MISS = /davezagin-max\.github\.io\/powder-index\/data\/manifest\.json/;
const WASM = readdirSync(new URL("public/duckdb/", root)).filter((f) => f.endsWith(".wasm"));

const CONFIGS = [
  { id: "desktop light", viewport: { width: 1280, height: 800 }, scheme: "light" },
  { id: "phone light", viewport: { width: 390, height: 844 }, scheme: "light" },
  { id: "desktop dark", viewport: { width: 1280, height: 800 }, scheme: "dark" },
  { id: "phone dark", viewport: { width: 390, height: 844 }, scheme: "dark" },
];

const longDate = (iso) =>
  new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${iso}T00:00:00Z`),
  );
const mediumDate = (iso) =>
  new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${iso}T00:00:00Z`),
  );
const shiftDate = (iso, days) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** True for a dark color. Handles oklch() (what Tailwind 4 emits) and rgb(). */
function isDarkColor(css) {
  const numbers = (css.match(/[\d.]+/g) ?? []).map(Number);
  if (css.startsWith("oklch(")) return numbers[0] < 0.5;
  const [r = 255, g = 255, b = 255] = numbers;
  return (r + g + b) / 3 < 128;
}

function must(condition, message) {
  if (!condition) throw new Error(message);
}

async function poll(check, what, timeout = 8000) {
  const end = Date.now() + timeout;
  let last = "no answer";
  while (Date.now() < end) {
    try {
      if (await check()) return;
    } catch (error) {
      last = error.message;
    }
    await sleep(120);
  }
  throw new Error(`${what} (last state: ${last})`);
}

const txt = async (locator) =>
  ((await locator.first().textContent({ timeout: 8000 })) ?? "").replace(/\s+/g, " ").trim();

const search = (page) => page.evaluate(() => location.search);
const param = async (page, name) => new URLSearchParams(await search(page)).get(name);

async function hydrated(page) {
  await page.waitForFunction(
    () => {
      const el = document.querySelector("header button");
      return !!el && Object.keys(el).some((key) => key.startsWith("__reactProps"));
    },
    null,
    { timeout: 20_000 },
  );
}

/** Ask panel: wait until the answer for `question` has rendered (or failed) and nothing is busy. */
async function waitAnswer(page, question) {
  await poll(
    async () => {
      const shown = await page.locator("#ask p", { hasText: "Question:" }).filter({ hasText: question }).count();
      const busy = await page.locator("#ask span.animate-spin").count();
      return shown > 0 && busy === 0;
    },
    `no answer for "${question}" in time`,
    60_000,
  );
  if ((await page.locator("#ask figure").count()) > 0) return "answered";
  if ((await page.locator("#ask [role=alert]").count()) > 0) return "alert";
  return "other";
}

/** A drawn answer: an SVG chart, the bar rows of a single-series bar chart, or a table. */
async function drawn(page) {
  return (
    (await page.locator("#ask figure svg").count()) > 0 ||
    (await page.locator("#ask figure table").count()) > 0 ||
    (await page.locator("#ask figure ul > li > span[title]").count()) > 0
  );
}

async function clickPreset(page, question) {
  await page.locator('#ask ul[aria-labelledby="preset-label"] button', { hasText: question }).click();
}

const rows = [];
const overflowFails = [];
const errorBag = [];
let allowed = [];
let cfg = CONFIGS[0];

function record(id, name, status, detail = "") {
  rows.push({ id, name, config: cfg.id, status, detail });
}

function blocked(id, name, detail) {
  record(id, name, "BLOCKED", detail);
}

/** Runs one check on the page, then checks the page did not scroll sideways. */
async function step(page, id, name, fn) {
  try {
    record(id, name, "PASS", (await fn()) ?? "");
  } catch (error) {
    record(id, name, "FAIL", String(error?.message ?? error).split("\n")[0].slice(0, 400));
  }
  try {
    const fit = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: window.innerWidth }));
    if (fit.scroll > fit.width) overflowFails.push(`${id} scrollWidth ${fit.scroll} > ${fit.width}`);
  } catch {
    // The page can be gone if an earlier step closed it; that step has already been recorded.
  }
}

async function open(browser, path, options = {}) {
  const context = await browser.newContext({ viewport: cfg.viewport, colorScheme: cfg.scheme });
  if (options.init) await context.addInitScript(options.init.fn, options.init.arg);
  if (options.route) await context.route("**/api/ask", options.route);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(`uncaught exception: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const where = message.location()?.url ?? "";
    const text = message.text();
    if (PAGES_MISS.test(`${where} ${text}`)) {
      allowed.push("published manifest on GitHub Pages (Pages not enabled)");
      return;
    }
    if (options.allow && options.allow.test(`${where} ${text}`)) {
      allowed.push(options.allowNote);
      return;
    }
    errors.push(`console error: ${text}${where ? ` at ${where}` : ""}`);
  });
  await page.goto(BASE + path, { waitUntil: "domcontentloaded" });
  await hydrated(page);
  return { context, page, errors };
}

/** Opens a page, runs `body` on it, and keeps its console errors for the config summary. */
async function group(browser, name, path, options, body) {
  let opened;
  try {
    opened = await open(browser, path, options);
  } catch (error) {
    record(name, `open ${path}`, "FAIL", error.message.split("\n")[0]);
    return;
  }
  const { context, page, errors } = opened;
  try {
    await body(page);
  } catch (error) {
    record(name, "group ran to the end", "FAIL", error.message.split("\n")[0].slice(0, 300));
  } finally {
    errorBag.push(...errors);
    await context.close();
  }
}

// ---------------------------------------------------------------------------
// Group 1: the first screen, header, footer, theme.
// ---------------------------------------------------------------------------
async function firstScreen(page) {
  await step(page, "F01", "Skip link is the first Tab stop and moves to the content", async () => {
    await page.keyboard.press("Tab");
    const focused = await page.evaluate(() => ({
      text: document.activeElement?.textContent?.trim(),
      href: document.activeElement?.getAttribute("href"),
    }));
    must(focused.text === "Skip to content" && focused.href === "#main", `first Tab stop was ${JSON.stringify(focused)}`);
    await page.keyboard.press("Enter");
    await poll(() => page.evaluate(() => location.hash === "#main"), "Enter on the skip link did not reach #main");
    return "Tab reaches it; Enter goes to #main";
  });

  await step(page, "F02", "Headline and one-liner on the first screen", async () => {
    const headline = await txt(page.locator("#intro-heading"));
    must(headline === "Which Utah ski resort has the best fresh snow?", `headline was "${headline}"`);
    const oneLiner = await txt(page.locator('section[aria-labelledby="intro-heading"] p').first());
    must(oneLiner.includes(`ranks ${RESORTS.length} Utah ski resorts every day with a score from 0 to 100`), `one-liner was "${oneLiner}"`);
    return `${RESORTS.length} resorts, score 0 to 100, plain-language one-liner`;
  });

  await step(page, "F03", "Replay the best day is the primary action and sits above the fold", async () => {
    const button = page.getByRole("button", { name: /Replay the best day of last winter/ });
    await button.waitFor({ state: "visible" });
    const box = await button.boundingBox();
    must(box && box.y + box.height <= cfg.viewport.height, `button bottom ${Math.round((box?.y ?? 0) + (box?.height ?? 0))}px is below the fold (${cfg.viewport.height}px)`);
    return `ends at ${Math.round(box.y + box.height)}px of ${cfg.viewport.height}px`;
  });

  await step(page, "F04", "Demo banner says the AI answers are pre-written; its Add key button opens the key dialog", async () => {
    must((await page.locator("span:visible", { hasText: "pre-written" }).count()) > 0, "no visible banner text mentions pre-written answers");
    await page.getByRole("button", { name: "Add key", exact: true }).click();
    await poll(async () => (await page.locator("dialog[open]").count()) === 1, "the key dialog did not open");
    await page.keyboard.press("Escape");
    await poll(async () => (await page.locator("dialog[open]").count()) === 0, "Escape did not close the key dialog");
    return "dialog opens from the banner and closes on Escape";
  });

  await step(page, "F05", "Off-season note explains why every score is near zero", async () => {
    await page.getByText("Off-season: an inch of snow or less at every resort,").first().waitFor({ state: "visible" });
    return "shown on the default (latest) day";
  });

  await step(page, "F06", "Source line names the data and the day it runs through", async () => {
    const line = await txt(page.locator("p", { hasText: "readings through" }));
    must(
      line.includes("snapshot bundled with this build") && line.includes(`readings through ${mediumDate(bundled.asOf)}`),
      `line was "${line}"`,
    );
    return line;
  });

  await step(page, "F07", "Header section links work on desktop and are hidden on a phone", async () => {
    const nav = page.locator('nav[aria-label="Sections"]');
    if (cfg.viewport.width < 768) {
      must(!(await nav.isVisible()), "section links showed on a phone");
      return "hidden below 768px, as designed";
    }
    for (const label of ["Ranking", "History", "Ask the data", "How it works"]) {
      must(await nav.getByRole("link", { name: label, exact: true }).isVisible(), `missing header link "${label}"`);
    }
    await nav.getByRole("link", { name: "Ask the data", exact: true }).click();
    await poll(() => page.evaluate(() => location.hash === "#ask"), "the header link did not set #ask");
    await poll(() => page.evaluate(() => document.querySelector("#ask").getBoundingClientRect().top < innerHeight), "the Ask section did not come into view");
    return "four links; Ask the data scrolls to the panel";
  });

  await step(page, "F08", "Theme toggle switches light and dark, and the choice survives a reload", async () => {
    const toggle = () => page.getByRole("button", { name: /Switch to (dark|light) theme/ });
    const start = await page.evaluate(() => document.documentElement.dataset.theme);
    must(start === cfg.scheme, `theme started as ${start}, expected ${cfg.scheme}`);
    const flipped = cfg.scheme === "dark" ? "light" : "dark";
    await toggle().click();
    await poll(() => page.evaluate((t) => document.documentElement.dataset.theme === t, flipped), `theme did not become ${flipped}`);
    await page.reload();
    await hydrated(page);
    const kept = await page.evaluate(() => document.documentElement.dataset.theme);
    must(kept === flipped, `after reload the theme was ${kept}`);
    await toggle().click();
    await poll(() => page.evaluate((t) => document.documentElement.dataset.theme === t, start), "theme did not switch back");
    return `${start} -> ${flipped} -> kept after reload -> ${start}`;
  });

  await step(page, "F09", "Each theme paints its own background", async () => {
    const background = await page.evaluate(() => {
      const el = [document.body, document.documentElement].find(
        (node) => getComputedStyle(node).backgroundColor !== "rgba(0, 0, 0, 0)",
      );
      return el ? getComputedStyle(el).backgroundColor : "transparent";
    });
    must(isDarkColor(background) === (cfg.scheme === "dark"), `${cfg.scheme} theme background is ${background}`);
    return background;
  });

  await step(page, "F10", "Footer carries the safety disclaimer and a link to the Utah Avalanche Center", async () => {
    const footer = page.locator("footer");
    await footer.scrollIntoViewIfNeeded();
    must(await footer.getByText("Not avalanche or safety information.").isVisible(), "disclaimer not visible in the footer");
    const link = footer.getByRole("link", { name: "Utah Avalanche Center forecast" });
    must((await link.getAttribute("href")) === "https://utahavalanchecenter.org", "the link does not go to utahavalanchecenter.org");
    must((await link.getAttribute("target")) === "_blank", "the link does not open a new tab");
    return "disclaimer visible; link opens utahavalanchecenter.org in a new tab";
  });

  await step(page, "F11", "Faint topographic contour background is present and hidden from assistive tech", async () => {
    const count = await page.locator('svg[aria-hidden="true"] pattern#topo').count();
    must(count === 1, `topo pattern count ${count}`);
    return "contour pattern behind the page";
  });
}

// ---------------------------------------------------------------------------
// Group 2: replaying a date.
// ---------------------------------------------------------------------------
async function replay(page) {
  const heading = page.locator('section[aria-label="Report date"] h2');
  const prev = page.getByRole("button", { name: "Previous day" });
  const next = page.getByRole("button", { name: "Next day" });
  const latest = page.getByRole("button", { name: "Latest", exact: true });

  await step(page, "F12", "Previous and next arrows step one day; the ends are disabled; Latest returns", async () => {
    must((await txt(heading)) === longDate(LATEST), `heading was "${await txt(heading)}"`);
    must(await next.isDisabled(), "next should be disabled on the latest day");
    must(await latest.isDisabled(), "Latest should be disabled on the latest day");
    await prev.click();
    await poll(async () => (await txt(heading)) === longDate(shiftDate(LATEST, -1)), "previous did not step back a day");
    must((await param(page, "date")) === shiftDate(LATEST, -1), "the URL did not carry the replayed date");
    must(await page.getByText("Replaying the morning of").first().isVisible(), "the replay label did not show");
    await next.click();
    await poll(async () => (await txt(heading)) === longDate(LATEST), "next did not return to the latest day");
    must((await param(page, "date")) === null, "the latest day should keep the URL clean");
    return `${longDate(LATEST)} -> previous -> back to latest`;
  });

  await step(page, "F13", "Date picker jumps to a chosen day; a date outside the data is ignored", async () => {
    await page.fill("#report-date", BEST);
    await poll(async () => (await txt(heading)) === longDate(BEST), `the date picker did not jump to ${BEST}`);
    must((await param(page, "date")) === BEST, "the URL did not carry the picked date");
    await page.fill("#report-date", "2030-01-01");
    await sleep(300);
    must((await txt(heading)) === longDate(BEST), "a date after the data changed the view");
    return `${longDate(BEST)}; 2030-01-01 ignored`;
  });

  await step(page, "F14", "Latest button returns to the newest morning report", async () => {
    await latest.click();
    await poll(async () => (await txt(heading)) === longDate(LATEST), "Latest did not return");
    must(await latest.isDisabled(), "Latest should be disabled again");
    return "back on the latest report";
  });

  await step(page, "F15", "Best-day chips open their day and mark the one showing", async () => {
    const chips = page.locator('ul[aria-labelledby="best-days-label"] button');
    must((await chips.count()) === bundled.bestDays.length, `${await chips.count()} chips, expected ${bundled.bestDays.length}`);
    const second = chips.nth(1);
    await second.click();
    await poll(async () => (await txt(heading)) === longDate(SECOND_BEST), "the chip did not open its day");
    must((await second.getAttribute("aria-pressed")) === "true", "the chip is not marked as showing");
    await latest.click();
    await poll(async () => (await txt(heading)) === longDate(LATEST), "could not return to the latest day");
    return `${bundled.bestDays.length} chips; the second opens ${longDate(SECOND_BEST)}`;
  });

  await step(page, "F16", "Replay the best day of last winter, then Back to today", async () => {
    await page.getByRole("button", { name: /Replay the best day of last winter/ }).click();
    await poll(async () => (await txt(heading)) === longDate(BEST), "the replay button did not open the best day");
    must(await page.getByText("resorts have snow on the ground").first().isVisible(), "the snow summary did not replace the off-season note");
    await page.getByRole("button", { name: "Back to today", exact: true }).click();
    await poll(async () => (await txt(heading)) === longDate(LATEST), "Back to today did not return");
    return `${longDate(BEST)} shows snow; Back to today returns`;
  });

  await step(page, "F17", "Intro Ask the data button runs the season question and draws the answer", async () => {
    await page.locator('section[aria-labelledby="intro-heading"] button', { hasText: "Ask the data" }).click();
    const outcome = await waitAnswer(page, INTRO_QUESTION);
    must(outcome === "answered", `answer outcome was ${outcome}`);
    return `answered: "${INTRO_QUESTION}"`;
  });
}

// ---------------------------------------------------------------------------
// Group 3: ranking, score breakdown, map, history, score explainer, lineage.
// ---------------------------------------------------------------------------
async function dashboard(page) {
  const cards = page.locator("#ranking ol > li > button");
  const cardInfo = () =>
    cards.evaluateAll((nodes) =>
      nodes.map((node) => {
        const match = /^Rank (\d+): (.+?), powder score ([\d.]+)/.exec(node.getAttribute("aria-label") ?? "");
        return match ? { rank: Number(match[1]), name: match[2], score: Number(match[3]) } : null;
      }),
    );
  const detailName = () => txt(page.locator("#resort-heading"));

  await step(page, "F18", "Ranking shows every resort, in rank order, with its score", async () => {
    const info = await cardInfo();
    must(info.length === RESORTS.length, `${info.length} cards, expected ${RESORTS.length}`);
    must(info.every((card, i) => card && card.rank === i + 1), "ranks are not 1 to 12 in order");
    must(info.every((card, i) => i === 0 || card.score <= info[i - 1].score), "scores are not in descending order");
    must(new Set(info.map((card) => card.name)).size === RESORTS.length, "a resort appears twice");
    return `12 cards, rank 1 is ${info[0].name} at ${info[0].score}`;
  });

  await step(page, "F19", "Clicking a ranking card opens that resort; the keyboard does the same", async () => {
    const names = (await cardInfo()).map((card) => card.name);
    const second = names[1];
    await cards.nth(1).click();
    await poll(async () => (await detailName()) === second, `clicking the card did not open ${second}`);
    const id = RESORTS.find((r) => r.name === second).id;
    must((await param(page, "resort")) === id, "the URL did not carry the resort");
    must((await cards.nth(1).getAttribute("aria-pressed")) === "true", "the card is not marked selected");
    const third = names[2];
    await cards.nth(2).focus();
    await page.keyboard.press("Enter");
    await poll(async () => (await detailName()) === third, `Enter on a card did not open ${third}`);
    return `click opens ${second}; Enter opens ${third}`;
  });

  await step(page, "F20", "Each card shows its new-snow and base readings and the color key for the score", async () => {
    const ranking = page.locator("#ranking");
    must(await ranking.getByText("Points from:").isVisible(), "the color key is missing");
    for (const label of ["New, 24 h", "New, 72 h", "Base"]) {
      must(await ranking.getByText(label, { exact: true }).first().isVisible(), `card label "${label}" missing`);
    }
    return "New, 24 h / New, 72 h / Base and the Points from key";
  });

  await step(page, "F21", "The selected resort's breakdown adds up to its headline score", async () => {
    const detail = page.locator("#resort");
    const points = await detail.locator("table tbody tr").evaluateAll((trs) =>
      trs.map((tr) => (tr.querySelector("td:last-child")?.textContent ?? "").replace(/\s+/g, " ").trim()),
    );
    const parts = points.map((cell) => {
      const match = /^([\d.]+) \/ ([\d.]+)$/.exec(cell);
      return match ? Number(match[1]) : null;
    });
    must(points.length === 6, `${points.length} component rows, expected 6`);
    const sum = parts.reduce((total, part) => total + (part ?? 0), 0);
    const footer = Number(/^([\d.]+)/.exec(await txt(detail.locator("tfoot td:last-child")))[1]);
    const headline = Number(await txt(detail.locator("p.text-3xl")));
    must(Math.abs(sum - footer) < 0.06, `parts add to ${sum.toFixed(2)} but the footer says ${footer}`);
    must(Math.abs(footer - headline) <= 0.5, `footer ${footer} does not round to the headline ${headline}`);
    return `parts sum to ${sum.toFixed(1)} = footer ${footer} = headline ${headline}`;
  });

  await step(page, "F22", "Map shows all twelve resorts as markers", async () => {
    const names = await page
      .locator('svg [role="button"][aria-label$="Show history."]')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("aria-label").split(":")[0]));
    const unique = new Set(names);
    must(unique.size === RESORTS.length, `${unique.size} distinct markers, expected ${RESORTS.length}`);
    return `${unique.size} resort markers`;
  });

  await step(page, "F23", "Map markers open a resort on click and with Enter", async () => {
    await page.locator('svg [role="button"][aria-label^="Alta:"]').first().click();
    await poll(async () => (await detailName()) === "Alta", "clicking the Alta marker did not open Alta");
    const snowbird = page.locator('svg [role="button"][aria-label^="Snowbird:"]').first();
    await snowbird.focus();
    await page.keyboard.press("Enter");
    await poll(async () => (await detailName()) === "Snowbird", "Enter on the Snowbird marker did not open Snowbird");
    return "click opens Alta; Enter opens Snowbird";
  });

  await step(page, "F57", "Map markers also open a resort with the Space bar", async () => {
    const brighton = page.locator('svg [role="button"][aria-label^="Brighton:"]').first();
    await brighton.focus();
    await page.keyboard.press(" ");
    await poll(async () => (await detailName()) === "Brighton", "Space on the Brighton marker did not open Brighton");
    return "Space opens Brighton";
  });

  await step(page, "F24", "Resort selector changes the resort shown", async () => {
    const select = page.locator("#resort-select");
    must((await select.locator("option").count()) === RESORTS.length, "the selector does not list all resorts");
    await select.selectOption("alta");
    await poll(async () => (await detailName()) === "Alta" && (await param(page, "resort")) === "alta", "the selector did not open Alta");
    await select.selectOption("snowbird");
    await poll(async () => (await detailName()) === "Snowbird", "the selector did not open Snowbird");
    return `${RESORTS.length} options; Alta and Snowbird open`;
  });

  const history = () => page.locator('[role="group"][aria-label^="History for Snowbird"]');

  await step(page, "F25", "History charts: three panels on one time axis", async () => {
    await page.locator("#resort-select").selectOption("snowbird");
    await poll(async () => (await detailName()) === "Snowbird", "could not open Snowbird");
    for (const title of ["Powder score", "New snow in 24 hours (in)", "Snow depth (in)"]) {
      must(await history().getByText(title, { exact: true }).isVisible(), `panel "${title}" is missing`);
    }
    return "Powder score, New snow in 24 hours, Snow depth";
  });

  await step(page, "F26", "History chart moves the report date with the arrow keys, Shift, Home and End", async () => {
    await history().focus();
    await page.keyboard.press("ArrowLeft");
    await poll(async () => (await param(page, "date")) === shiftDate(LATEST, -1), "ArrowLeft did not step back one day");
    await page.keyboard.press("Shift+ArrowLeft");
    await poll(async () => (await param(page, "date")) === shiftDate(LATEST, -8), "Shift+ArrowLeft did not step back a week");
    await page.keyboard.press("Home");
    await poll(async () => (await param(page, "date")) === FIRST, "Home did not go to the first day");
    await page.keyboard.press("End");
    await poll(async () => (await param(page, "date")) === null, "End did not return to the latest day");
    return `ArrowLeft, Shift+ArrowLeft, Home and End all move the date`;
  });

  await step(page, "F27", "Hovering the history chart shows that day's score, new snow and depth", async () => {
    const overlay = history().locator("div.cursor-crosshair");
    const box = await overlay.boundingBox();
    must(box, "the chart pointer surface is not laid out");
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height / 2);
    await poll(async () => (await page.locator('[role="group"][aria-label^="History for Snowbird"] dt', { hasText: /^Score$/ }).count()) > 0, "no tooltip appeared");
    const tooltip = history().locator("div[aria-hidden='true']", { hasText: "Depth" }).first();
    must(await tooltip.getByText("New snow, 24 h").isVisible(), "tooltip is missing New snow, 24 h");
    must(await tooltip.getByText("Depth", { exact: true }).isVisible(), "tooltip is missing Depth");
    await page.mouse.move(0, 0);
    return "tooltip lists Score, New snow, 24 h and Depth";
  });

  await step(page, "F28", "Clicking the history chart sets the report date", async () => {
    const overlay = history().locator("div.cursor-crosshair");
    const box = await overlay.boundingBox();
    await overlay.click({ position: { x: box.width * 0.5, y: box.height / 2 } });
    await poll(async () => {
      const date = await param(page, "date");
      return date !== null && DATES.includes(date) && (await txt(page.locator('section[aria-label="Report date"] h2'))) === longDate(date);
    }, "clicking the chart did not set a report date");
    const date = await param(page, "date");
    await page.getByRole("button", { name: "Latest", exact: true }).click();
    await poll(async () => (await param(page, "date")) === null, "could not return to the latest day");
    return `clicked the middle of the chart: ${longDate(date)}`;
  });

  await step(page, "F29", "Station panel names the stations and says a station is only a stand-in", async () => {
    const detail = page.locator("#resort");
    must(await detail.getByText("Measured at", { exact: true }).isVisible(), "the Measured at heading is missing");
    must(await detail.getByText("A station is a stand-in for the resort, not its own stake.").isVisible(), "the proxy caveat is missing");
    return "Measured at, with the stand-in caveat";
  });

  const how = () => page.locator("#how");

  await step(page, "F30", "Score explainer: six components whose weights add up to 100%", async () => {
    await how().scrollIntoViewIfNeeded();
    const rows = how().locator("table tbody tr");
    must((await rows.count()) === 6, `${await rows.count()} component rows, expected 6`);
    const weights = await rows.evaluateAll((trs) => trs.map((tr) => Number(tr.querySelectorAll("td")[0].textContent.replace("%", ""))));
    must(weights.reduce((a, b) => a + b, 0) === 100, `weights add to ${weights.reduce((a, b) => a + b, 0)}`);
    const first = await txt(rows.nth(0));
    must(first.includes("0 in") && first.includes("12 in"), `new snow anchors were "${first}"`);
    return `six rows; weights ${weights.join(" + ")} = 100%`;
  });

  await step(page, "F31", "Score explainer lists the five tiers", async () => {
    const items = (await how().locator("ul li").allTextContents()).map((t) => t.replace(/\s+/g, " ").trim());
    for (const tier of ["Epic 75+", "Powder day 55+", "Soft turns 35+", "Firm 15+", "Off 0+"]) {
      must(items.includes(tier), `tier "${tier}" is missing (saw ${items.join("; ")})`);
    }
    return "Epic 75+, Powder day 55+, Soft turns 35+, Firm 15+, Off 0+";
  });

  await step(page, "F32", "How the score works: the in-page link scrolls there; the source link points at GitHub", async () => {
    await page.locator('#ranking a[href="#how"]').click();
    await poll(() => page.evaluate(() => location.hash === "#how"), "the link did not set #how");
    await poll(() => page.evaluate(() => document.querySelector("#how").getBoundingClientRect().top < innerHeight), "the explainer did not come into view");
    const source = how().getByRole("link", { name: "Source on GitHub" });
    must((await source.getAttribute("href")) === REPO_URL, "the source link points elsewhere");
    return "in-page link works; Source on GitHub points at the repository";
  });

  // The dbt docs link is a GitHub Pages address. It is checked here, not clicked, and a 404 is
  // reported as blocked because Pages is not enabled yet.
  {
    const docsHref = await how().locator('a[href*="/docs/"]').getAttribute("href");
    must(docsHref === DOCS_URL, `the dbt docs link is ${docsHref}`);
    let status = "unreachable";
    try {
      status = (await fetch(DOCS_URL, { redirect: "manual", signal: AbortSignal.timeout(15_000) })).status;
    } catch {
      // stays "unreachable"
    }
    if (status === 200) record("F33", "dbt docs link opens the published docs", "PASS", DOCS_URL);
    else blocked("F33", "dbt docs link opens the published docs", `${DOCS_URL} answers ${status}: GitHub Pages is not enabled yet (David enables it). Not a bug.`);
  }

  await step(page, "F34", "Lineage diagram: labelled, and scrolls sideways inside its own box on a phone", async () => {
    const figure = how().locator("figure");
    must(await figure.getByText("Lineage: from two public APIs to one score").isVisible(), "lineage caption missing");
    const region = how().locator('[role="region"][aria-label="dbt lineage diagram, scrollable"]');
    must((await region.getAttribute("tabindex")) === "0", "the diagram box is not keyboard reachable");
    const label = await how().locator('svg[role="img"]').first().getAttribute("aria-label");
    must(label?.startsWith("dbt lineage:"), `diagram label was "${label}"`);
    const scrolls = await region.evaluate((el) => el.scrollWidth > el.clientWidth);
    if (cfg.viewport.width < 768) must(scrolls, "on a phone the diagram should scroll inside its box");
    return scrolls ? "scrolls inside its own box" : "fits without scrolling at this width";
  });
}

// ---------------------------------------------------------------------------
// Group 4: Ask the data, demo mode (no key).
// ---------------------------------------------------------------------------
async function askDemo(page) {
  const ask = () => page.locator("#ask");

  await step(page, "F35", "Ask: eight preset questions", async () => {
    const buttons = await page.locator('#ask ul[aria-labelledby="preset-label"] button').allTextContents();
    const texts = buttons.map((t) => t.replace(/\s+/g, " ").trim());
    must(texts.length === PRESETS.length, `${texts.length} presets, expected ${PRESETS.length}`);
    for (const preset of PRESETS) must(texts.includes(preset.question), `preset missing: ${preset.question}`);
    return `${texts.length} presets, all listed`;
  });

  await step(page, "F36", "Every preset runs its SQL in the browser and draws a chart or a table", async () => {
    const report = [];
    for (const preset of PRESETS) {
      await clickPreset(page, preset.question);
      const outcome = await waitAnswer(page, preset.question);
      must(outcome === "answered", `${preset.id}: ${outcome}`);
      const title = await txt(ask().locator("figure h3"));
      must(title === fixtures[preset.id].data.title, `${preset.id}: title "${title}"`);
      const sql = await txt(ask().locator('pre[aria-label="The SQL that ran"]'));
      must(/SELECT/.test(sql), `${preset.id}: no SQL shown`);
      const rowsLine = await txt(ask().locator("figure p", { hasText: "rows in" }));
      const rows = Number(/^([\d,]+) rows? in/.exec(rowsLine)?.[1].replace(/,/g, "") ?? 0);
      must(rows >= 1, `${preset.id}: no rows (${rowsLine})`);
      must(await drawn(page), `${preset.id}: nothing drawn`);
      report.push(`${preset.id} ${rows}`);
    }
    return `rows per preset: ${report.join(", ")}`;
  });

  await step(page, "F37", "Chart and table views switch", async () => {
    await clickPreset(page, "Which resort got the most snow last season?");
    await waitAnswer(page, "Which resort got the most snow last season?");
    const toggle = (name) => ask().locator('[role="group"][aria-label="View"] button', { hasText: name });
    await toggle("table").click();
    await poll(async () => (await ask().locator("figure table").count()) > 0, "the table view did not show");
    must((await toggle("table").getAttribute("aria-pressed")) === "true", "table is not marked as showing");
    await toggle("chart").click();
    await poll(async () => (await ask().locator("figure table").count()) === 0 && (await drawn(page)), "the chart view did not return");
    return "table and chart both show the same answer";
  });

  await step(page, "F38", "Answer shows the SQL that ran, the sample label, and the cost line", async () => {
    const sql = await txt(ask().locator('pre[aria-label="The SQL that ran"]'));
    must(sql.includes("FROM resort_daily"), "the SQL does not read resort_daily");
    must(await ask().getByText("Regenerated by the SQL firewall").isVisible(), "the firewall note is missing");
    must(await ask().getByText("Sample answer: this SQL was written by hand").isVisible(), "the sample label is missing");
    must(await ask().getByText("Sample (not a real run):").isVisible(), "the cost line does not say sample");
    return "SQL, firewall note, and sample labels all show";
  });

  await step(page, "F39", "Retry trail: a sample answer shows the failed attempts and their real errors", async () => {
    await clickPreset(page, TRAIL_PRESET.question);
    must((await waitAnswer(page, TRAIL_PRESET.question)) === "answered", "the trail question did not answer");
    const trail = ask().locator('section[aria-label="Earlier attempts"]');
    must(await trail.isVisible(), "the retry trail is not shown");
    const heading = await txt(trail.locator("h4"));
    must(heading === "Sample retry trail: 2 attempts written by hand to fail, with the real error each one gets back", `heading was "${heading}"`);
    const stages = fixtures[TRAIL_PRESET.id].data.trail.map((s) => s.stage);
    const labels = { validator: "Blocked by the SQL firewall", engine: "Rejected by DuckDB" };
    for (const [i, stage] of stages.entries()) {
      must(await trail.getByText(`Attempt ${i + 1}. ${labels[stage]}:`).isVisible(), `attempt ${i + 1} label missing`);
    }
    await trail.locator("details summary").first().click();
    await poll(async () => (await trail.locator("details pre").first().textContent())?.trim().length > 0, "the failed SQL did not show");
    return `${stages.length} attempts: ${stages.map((s) => labels[s]).join(", ")}`;
  });

  await step(page, "F40", "What can I ask about: the schema reference opens", async () => {
    const columns = schema.tables.reduce((sum, table) => sum + table.columns.length, 0);
    const summary = ask().locator("details summary", { hasText: "What can I ask about?" });
    const label = await txt(summary);
    must(label === `What can I ask about? ${schema.tables.length} tables, ${columns} columns`, `summary was "${label}"`);
    await summary.click();
    await poll(async () => (await ask().locator("details[open] h3", { hasText: "resort_daily" }).count()) > 0, "the schema did not open");
    return label;
  });

  await step(page, "F41", "Free question without a key explains itself and offers the key dialog", async () => {
    const input = page.locator("#ask-input");
    must(await input.isDisabled(), "the question box is enabled without a key");
    must((await input.getAttribute("placeholder")) === "Your own questions need an Anthropic key", "placeholder does not explain the key");
    must(await ask().getByText("The presets above run without a key.").isVisible(), "the no-key hint is missing");
    await page.getByRole("button", { name: "Add key to ask your own" }).click();
    await poll(async () => (await page.locator("dialog[open]").count()) === 1, "Add key did not open the dialog");
    await page.keyboard.press("Escape");
    await poll(async () => (await page.locator("dialog[open]").count()) === 0, "Escape did not close the dialog");
    return "box disabled; the button opens and closes the key dialog";
  });

  await step(page, "F42", "Key dialog refuses a malformed key, and Cancel closes it", async () => {
    await page.getByRole("button", { name: "Add key to ask your own" }).click();
    const dialog = page.locator("dialog[open]");
    await poll(async () => (await dialog.count()) === 1, "the dialog did not open");
    await dialog.locator('input[name="key"]').fill("not-a-key");
    await dialog.getByRole("button", { name: "Use this key" }).click();
    const error = await txt(dialog.getByRole("alert"));
    must(error.startsWith("Anthropic keys start with sk-ant-"), `error was "${error}"`);
    must((await page.locator("dialog[open]").count()) === 1, "the dialog closed on a bad key");
    must(await page.locator("#ask-input").isDisabled(), "a bad key switched the box on");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await poll(async () => (await page.locator("dialog[open]").count()) === 0, "Cancel did not close the dialog");
    return "bad key rejected in words; Cancel closes";
  });

  await step(page, "F56", "A line chart answer: the crosshair reads every series at the hovered date", async () => {
    await clickPreset(page, LINE_PRESET.question);
    must((await waitAnswer(page, LINE_PRESET.question)) === "answered", "the line question did not answer");
    const overlay = ask().locator("figure div.cursor-crosshair");
    must((await overlay.count()) === 1, `${await overlay.count()} crosshair surfaces, expected 1`);
    const box = await overlay.boundingBox();
    must(box, "the line chart is not laid out");
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.4);
    await poll(async () => (await ask().locator("figure ul.tabular li").count()) >= 2, "the crosshair readout did not list the series");
    const readout = await ask().locator("figure ul.tabular li").allTextContents();
    await page.mouse.move(0, 0);
    return `${readout.length} series read at the hovered date`;
  });

  await step(page, "F58", "Key dialog: a click on the backdrop closes it; Create a key opens the Claude keys page in a new tab", async () => {
    await page.getByRole("button", { name: "Add key to ask your own" }).click();
    const dialog = page.locator("dialog[open]");
    await poll(async () => (await dialog.count()) === 1, "the dialog did not open");
    const link = dialog.getByRole("link", { name: "Create a key" });
    must((await link.getAttribute("href")) === "https://platform.claude.com/settings/keys", "Create a key does not link to the Claude keys page");
    must((await link.getAttribute("target")) === "_blank", "Create a key does not open a new tab");
    await page.mouse.click(4, 4);
    await poll(async () => (await page.locator("dialog[open]").count()) === 0, "a click on the backdrop did not close the dialog");
    return "backdrop click closes; Create a key opens platform.claude.com in a new tab";
  });
}

// ---------------------------------------------------------------------------
// Group 5: the live path with a key, Claude's answer stubbed on /api/ask.
// ---------------------------------------------------------------------------
const askMeta = {
  mode: "live",
  placeholder: false,
  recordedAt: null,
  model: "claude-opus-5-5",
  usage: { input_tokens: 1200, output_tokens: 150, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  costUsd: 0.0123,
};

async function fulfill(route, status, body) {
  try {
    await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  } catch {
    // The visitor cancelled and the browser dropped the request; nothing to answer.
  }
}

async function setKeyFromDialog(page) {
  await page.getByRole("button", { name: "Add key to ask your own" }).click();
  const dialog = page.locator("dialog[open]");
  await poll(async () => (await dialog.count()) === 1, "the key dialog did not open");
  await dialog.locator('input[name="key"]').fill(TEST_KEY);
  await dialog.locator('input[name="remember"]').check();
  await dialog.getByRole("button", { name: "Use this key" }).click();
  await poll(async () => (await page.locator("dialog[open]").count()) === 0, "the dialog did not close after a valid key");
}

async function liveKey(page) {
  await step(page, "F43", "A valid key switches to live mode, is remembered for the tab, and survives a reload", async () => {
    await setKeyFromDialog(page);
    must(await page.getByText("Live: your questions go to Claude Opus 5.5 with your key.").isVisible(), "the live banner did not show");
    must(!(await page.locator("#ask-input").isDisabled()), "the question box stayed disabled with a key");
    must(
      (await page.locator("#ask-input").getAttribute("placeholder")) === "Which resort had the coldest storm days?",
      "the placeholder did not switch to live wording",
    );
    must((await page.evaluate(() => sessionStorage.getItem("anthropic-key"))) === TEST_KEY, "the key was not remembered for the tab");
    await page.reload();
    await hydrated(page);
    await poll(async () => (await page.getByText("Live: your questions go to Claude Opus 5.5 with your key.").count()) > 0, "the key was lost on reload");
    return "live banner shows; key kept for this tab";
  });
}

async function liveSelfCorrect(page, calls) {
  await step(page, "F44", "Live question: a DuckDB error goes back to Claude with the failed SQL, then the answer shows the retry trail", async () => {
    const question = "Which resort got the most snow in March?";
    await page.locator("#ask-input").fill(question);
    await page.locator("#ask form button[type=submit]").click();
    must((await waitAnswer(page, question)) === "answered", "the live question did not answer");
    must(await page.getByText("Self-corrected: one attempt failed before this one worked").isVisible(), "the self-correction heading is missing");
    must(await page.locator("#ask section[aria-label='Earlier attempts']").getByText("no_such_column", { exact: false }).count() > 0, "the failed attempt's error is not shown");
    must(await page.getByText("Written just now by Claude Opus 5.5 with your key.").isVisible(), "the provenance line is wrong");
    must(await page.getByText("This run:").first().isVisible(), "the cost line did not show");
    must(calls.length === 2, `${calls.length} requests, expected 2`);
    must(calls[0].key === TEST_KEY, "the key did not travel in the header");
    must(calls[0].body.attempts.length === 0 && !("demoId" in calls[0].body), "the first request carried extra fields");
    must(calls[1].body.attempts.length === 1 && calls[1].body.attempts[0].sql === BAD_SQL, "the second request did not send the failed SQL back");
    must(calls[1].body.attempts[0].error.includes("no_such_column"), "the DuckDB error was not sent back");
    return "2 requests; the failed SQL and DuckDB's error went back in the second";
  });
}

async function liveStop(page, calls) {
  await step(page, "F45", "Stop cancels a live question and no further request is sent", async () => {
    await page.locator("#ask-input").fill("Which resort had the coldest storm days?");
    await page.locator("#ask form button[type=submit]").click();
    await poll(async () => (await page.getByRole("button", { name: "Stop", exact: true }).count()) > 0, "the Stop button did not appear");
    await page.getByRole("button", { name: "Stop", exact: true }).click();
    await poll(async () => (await page.getByText("Pick a question above to see the chart").count()) > 0, "Stop did not return to idle");
    await sleep(5500);
    must((await page.locator("#ask figure").count()) === 0, "an answer appeared after Stop");
    must(calls.length === 1, `${calls.length} requests after Stop, expected 1`);
    return "Stop returns to idle; no answer; one request only";
  });
}

async function liveAuthError(page) {
  await step(page, "F46", "A rejected key says so and offers Change key", async () => {
    await page.locator("#ask-input").fill("Which resort had the coldest storm days?");
    await page.locator("#ask form button[type=submit]").click();
    await poll(async () => (await page.getByText("Key problem.").count()) > 0, "no key problem message");
    must(await page.getByText("Anthropic did not accept this key.").isVisible(), "the server's message is not shown");
    await page.locator('#ask [role="alert"]').getByRole("button", { name: "Change key", exact: true }).click();
    await poll(async () => (await page.locator("dialog[open]").count()) === 1, "Change key did not open the dialog");
    await page.keyboard.press("Escape");
    return "Key problem. message; Change key opens the dialog";
  });
}

async function liveDeclined(page) {
  await step(page, "F47", "A question the tables cannot answer gets a clear decline with the reason", async () => {
    await page.locator("#ask-input").fill("Will the avalanche danger be high on Friday?");
    await page.locator("#ask form button[type=submit]").click();
    await poll(async () => (await page.getByText("The data cannot answer that.").count()) > 0, "no decline message");
    must(await page.getByText("The snow tables hold no avalanche forecasts").isVisible(), "the decline reason is not shown");
    return "decline heading and reason shown";
  });
}

async function liveNoFunction(page) {
  await step(page, "F48", "Live question on a server without the Ask function explains how to start it", async () => {
    await page.locator("#ask-input").fill("Which resort had the coldest storm days?");
    await page.locator("#ask form button[type=submit]").click();
    await poll(async () => (await page.getByText("The Ask API is not running", { exact: false }).count()) > 0, "no explanation shown");
    must(await page.getByRole("alert").first().isVisible(), "the explanation is not an alert");
    return "this build does not proxy /api/ask, and the page says so";
  });
}

async function removeKey(page) {
  await step(page, "F49", "Remove key in the dialog returns the page to demo mode", async () => {
    await page.getByRole("button", { name: "Change key", exact: true }).first().click();
    const dialog = page.locator("dialog[open]");
    await poll(async () => (await dialog.count()) === 1, "Change key did not open the dialog");
    await dialog.getByRole("button", { name: "Remove key" }).click();
    await poll(async () => (await page.locator("dialog[open]").count()) === 0, "Remove key did not close the dialog");
    must(await page.locator("span:visible", { hasText: "pre-written" }).count() > 0, "demo banner did not come back");
    must(await page.locator("#ask-input").isDisabled(), "the question box stayed enabled after removal");
    must((await page.evaluate(() => sessionStorage.getItem("anthropic-key"))) === null, "the key was still stored");
    return "demo banner back; box disabled; key cleared from the tab";
  });
}

// ---------------------------------------------------------------------------
// Group 6: deep links, the 404 page, data files, and the function route.
// ---------------------------------------------------------------------------
async function deepLink(page) {
  await step(page, "F50", "Deep link opens the date and resort it names", async () => {
    await poll(async () => (await txt(page.locator('section[aria-label="Report date"] h2'))) === longDate(BEST), "the linked date did not show");
    await poll(async () => (await txt(page.locator("#resort-heading"))) === "Snowbird", "the linked resort did not show");
    must((await page.locator("#resort-select").inputValue()) === "snowbird", "the selector does not match the link");
    return `${longDate(BEST)} and Snowbird from the URL`;
  });
}

async function badLink(page) {
  await step(page, "F51", "Invalid deep link falls back to the latest day and the top-ranked resort", async () => {
    await poll(async () => (await txt(page.locator('section[aria-label="Report date"] h2'))) === longDate(LATEST), "a bad date did not fall back to the latest day");
    const top = await txt(page.locator("#ranking ol > li > button").first().locator("h3"));
    await poll(async () => (await txt(page.locator("#resort-heading"))) === top, "a bad resort did not fall back to the top resort");
    return `falls back to ${longDate(LATEST)} and ${top}`;
  });
}

async function serverChecks(page) {
  await step(page, "F52", "Unknown address shows the 404 page", async () => {
    const response = await page.request.get(`${BASE}/no-such-page`);
    must(response.status() === 404, `status ${response.status()}`);
    must((await response.text()).includes("404"), "the 404 page does not say 404");
    return "HTTP 404 with a not-found page";
  });

  await step(page, "F53", "Bundled data and the DuckDB engine files are served", async () => {
    const dashboard = await page.request.get(`${BASE}/data/dashboard.json`);
    must(dashboard.status() === 200, `dashboard.json ${dashboard.status()}`);
    const json = await dashboard.json();
    must(json.resorts.length === RESORTS.length, "dashboard.json lists the wrong resorts");
    const manifest = await page.request.get(`${BASE}/data/manifest.json`);
    must(manifest.status() === 200, `manifest.json ${manifest.status()}`);
    for (const file of WASM) {
      const wasm = await page.request.get(`${BASE}/duckdb/${file}`);
      must(wasm.status() === 200, `${file} ${wasm.status()}`);
    }
    return `dashboard.json, manifest.json and ${WASM.length} engine files`;
  });

  await step(page, "F54", "This server does not proxy /api/ask (the Python function runs on 8140 or Vercel)", async () => {
    const response = await page.request.post(`${BASE}/api/ask`, { data: { question: "Which resort got the most snow last season?" } });
    must(response.status() === 404, `status ${response.status()}`);
    return "404 from Next: the live path needs ASK_API_ORIGIN or the function";
  });

  {
    let status = "unreachable";
    try {
      status = (await fetch(MANIFEST_URL, { redirect: "manual", signal: AbortSignal.timeout(15_000) })).status;
    } catch {
      // stays "unreachable"
    }
    if (status === 200) record("F55", "Published data on GitHub Pages is read", "PASS", MANIFEST_URL);
    else blocked("F55", "Published data on GitHub Pages is read", `${MANIFEST_URL} answers ${status}. Pages is not enabled, so the page keeps the bundled data. Not a bug.`);
  }
}

// ---------------------------------------------------------------------------
// Runner.
// ---------------------------------------------------------------------------
async function preflight() {
  try {
    const response = await fetch(`${BASE}/`, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  } catch (error) {
    console.error(`The production server is not answering on ${BASE} (${error.message}).`);
    console.error("Start it first: pnpm build && pnpm exec next start -p 3140");
    process.exit(2);
  }
}

const keyInit = {
  fn: (key) => {
    try {
      sessionStorage.setItem("anthropic-key", key);
    } catch {
      // Storage blocked: the key is not kept, and the test shows that.
    }
  },
  arg: TEST_KEY,
};

await preflight();
const browser = await chromium.launch({ headless: true });

for (const config of CONFIGS) {
  cfg = config;
  errorBag.length = 0;
  overflowFails.length = 0;
  allowed = [];

  await group(browser, "F01", "/", {}, firstScreen);
  await group(browser, "F12", "/", {}, replay);
  await group(browser, "F18", "/", {}, dashboard);
  await group(browser, "F35", "/", {}, askDemo);

  const calls = [];
  const liveRoute = async (route, request) => {
    const body = JSON.parse(request.postData() ?? "{}");
    calls.push({ body, key: request.headers()["x-anthropic-key"] ?? null });
    const data = calls.length === 1 ? { ...SEASON_TEMPLATE, question: body.question, sql: BAD_SQL, trail: [] } : { ...SEASON_TEMPLATE, question: body.question, trail: [] };
    await fulfill(route, 200, { ok: true, data, meta: askMeta });
  };
  await group(browser, "F43", "/", { route: liveRoute }, async (page) => {
    await liveKey(page);
    await liveSelfCorrect(page, calls);
    await removeKey(page);
  });

  const stopCalls = [];
  await group(browser, "F45", "/", {
    init: keyInit,
    route: async (route, request) => {
      stopCalls.push(request.postData());
      await sleep(5000);
      await fulfill(route, 200, { ok: true, data: { ...SEASON_TEMPLATE, trail: [] }, meta: askMeta });
    },
  }, (page) => liveStop(page, stopCalls));

  await group(browser, "F46", "/", {
    init: keyInit,
    route: (route) => fulfill(route, 401, { ok: false, error: { kind: "auth", message: "Anthropic did not accept this key." } }),
    allow: /\/api\/ask/,
    allowNote: "the 401 that this test stubs from /api/ask",
  }, (page) => liveAuthError(page));

  await group(browser, "F47", "/", {
    init: keyInit,
    route: (route, request) => {
      const body = JSON.parse(request.postData() ?? "{}");
      return fulfill(route, 200, {
        ok: true,
        data: {
          kind: "declined",
          question: body.question,
          title: null,
          note: null,
          sql: null,
          chart: null,
          limit: null,
          trail: [],
          reason: "The snow tables hold no avalanche forecasts, so this cannot be answered from them.",
        },
        meta: askMeta,
      });
    },
  }, (page) => liveDeclined(page));

  await group(browser, "F48", "/", {
    init: keyInit,
    allow: /\/api\/ask/,
    allowNote: "POST /api/ask 404 on this server (expected: not proxied in this build)",
  }, (page) => liveNoFunction(page));

  await group(browser, "F50", `/?date=${BEST}&resort=snowbird`, {}, deepLink);
  await group(browser, "F51", "/?date=2026-13-45&resort=nope", {}, badLink);
  await group(browser, "F52", "/", {}, serverChecks);

  record("C1", "Console and page errors", errorBag.length ? "FAIL" : "PASS", errorBag.length ? errorBag.slice(0, 3).join(" | ") : `none; allowed: ${[...new Set(allowed)].join("; ") || "nothing"}`);
  record("C2", "No sideways page scroll after any interaction", overflowFails.length ? "FAIL" : "PASS", overflowFails.length ? overflowFails.slice(0, 5).join("; ") : "checked after every step");
}

await browser.close();

// ---------------------------------------------------------------------------
// Summary: one line per check, across the four configurations.
// ---------------------------------------------------------------------------
const order = [];
for (const row of rows) if (!order.includes(row.id)) order.push(row.id);
const names = new Map(rows.map((row) => [row.id, row.name]));

console.log("");
console.log("| ID | Feature | desktop light | phone light | desktop dark | phone dark |");
console.log("| --- | --- | --- | --- | --- | --- |");
for (const id of order) {
  const cells = CONFIGS.map((c) => {
    const hit = rows.find((row) => row.id === id && row.config === c.id);
    return hit ? hit.status : "-";
  });
  console.log(`| ${id} | ${names.get(id)} | ${cells.join(" | ")} |`);
}

const failures = rows.filter((row) => row.status === "FAIL");
const blockedRows = rows.filter((row) => row.status === "BLOCKED");
const passed = rows.filter((row) => row.status === "PASS").length;

if (blockedRows.length) {
  console.log("\nBLOCKED (not bugs):");
  for (const row of [...new Map(blockedRows.map((row) => [`${row.id}|${row.detail}`, row])).values()]) {
    console.log(`  ${row.id} ${row.name}: ${row.detail}`);
  }
}
if (failures.length) {
  console.log("\nFAILURES:");
  for (const row of failures) console.log(`  [${row.config}] ${row.id} ${row.name}: ${row.detail}`);
}
console.log(
  `\n${passed} checks passed, ${failures.length} failed, ${new Set(blockedRows.map((r) => r.id)).size} blocked (across ${CONFIGS.length} configurations).`,
);
process.exit(failures.length ? 1 : 0);
