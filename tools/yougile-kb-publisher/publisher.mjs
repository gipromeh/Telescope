import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { homedir } from "node:os";
import path from "node:path";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const owner = "gipromeh";
const repository = "Telescope";
const branch = "main";
const queuePath = "MEETINGS/TO_PUBLISH";
const projectName = "Проектирование САО";
const knowledgeBaseName = "База знаний 12° Объектив";
const parentPageName = "Совещания";
const baseUrl = "https://ru.yougile.com/team/";
const pollIntervalMs = 5 * 60 * 1000;
const maxDocumentBytes = 1024 * 1024;

const localRoot = process.env.TELESCOPE_KB_PUBLISHER_HOME
  ? path.resolve(process.env.TELESCOPE_KB_PUBLISHER_HOME)
  : path.join(process.env.LOCALAPPDATA || homedir(), "Telescope", "YouGileKbPublisher");
const profileDir = path.join(localRoot, "browser-profile");
const statePath = path.join(localRoot, "published-state.json");
const args = new Set(process.argv.slice(2));

function log(message) {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

function normalizeText(value) {
  return String(value).replace(/\r\n?/g, "\n").replace(/\u00a0/g, " ").trim();
}

function titleFromFile(fileName) {
  const stem = path.basename(fileName, ".md");
  return stem.replace(/_meeting$/i, "");
}

async function loadState() {
  try {
    const text = await readFile(statePath, "utf8");
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && parsed.files ? parsed : { files: {} };
  } catch (error) {
    if (error?.code === "ENOENT") return { files: {} };
    throw new Error("Could not read the local publisher state file.");
  }
}

async function saveState(state) {
  await mkdir(localRoot, { recursive: true });
  const temporaryPath = `${statePath}.tmp`;
  await writeFile(temporaryPath, JSON.stringify(state, null, 2), "utf8");
  await rename(temporaryPath, statePath);
}

async function githubJson(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "Telescope-YouGile-KB-UI-Publisher",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`GitHub request failed (HTTP ${response.status}).`);
  }
  return response.json();
}

async function listQueuedFiles() {
  const url = new URL(
    `https://api.github.com/repos/${owner}/${repository}/contents/${queuePath}`,
  );
  url.searchParams.set("ref", branch);
  const entries = await githubJson(url);
  if (!Array.isArray(entries)) {
    throw new Error("GitHub queue path is not a directory.");
  }
  return entries.filter((entry) =>
    entry?.type === "file" &&
    typeof entry.name === "string" &&
    entry.name.toLowerCase().endsWith(".md") &&
    entry.name.toLowerCase() !== "readme.md" &&
    typeof entry.path === "string" &&
    typeof entry.sha === "string" &&
    typeof entry.download_url === "string"
  );
}

async function readQueuedFile(entry) {
  const sourceUrl = new URL(entry.download_url);
  if (sourceUrl.protocol !== "https:" || sourceUrl.hostname !== "raw.githubusercontent.com") {
    throw new Error("GitHub returned an unexpected meeting file URL.");
  }

  const response = await fetch(sourceUrl, {
    signal: AbortSignal.timeout(30_000),
    headers: { "User-Agent": "Telescope-YouGile-KB-UI-Publisher" },
  });
  if (!response.ok) {
    throw new Error(`Could not fetch queued file ${entry.name} (HTTP ${response.status}).`);
  }

  const body = await response.text();
  if (Buffer.byteLength(body, "utf8") > maxDocumentBytes) {
    throw new Error(`Queued file ${entry.name} exceeds the 1 MiB safety limit.`);
  }
  if (!body.trim()) {
    throw new Error(`Queued file ${entry.name} is empty.`);
  }
  return body;
}

async function openYouGile() {
  await mkdir(localRoot, { recursive: true });
  const context = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    viewport: null,
  });
  const page = context.pages()[0] ?? await context.newPage();
  await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
  return { context, page };
}

async function setupBrowserProfile() {
  const { context, page } = await openYouGile();
  const prompt = createInterface({ input: stdin, output: stdout });
  try {
    log("The separate automation browser is open. Sign in to YouGile manually, then open the target company.");
    log("No password or token is read by this script.");
    await prompt.question("When the target company is visible, press Enter here to finish setup. ");
  } finally {
    prompt.close();
    await context.close();
  }
}

async function clickExactText(page, text, description = text) {
  const locator = page.getByText(text, { exact: true });
  const count = await locator.count();
  if (count === 0) throw new Error(`Could not find ${description} in the YouGile page.`);
  await locator.first().click({ timeout: 15_000 });
}

async function findExistingPage(page, title) {
  const locator = page.getByText(title, { exact: true });
  return (await locator.count()) > 0;
}

async function publishPage(page, title, body) {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await clickExactText(page, projectName, "the configured YouGile project");
  await clickExactText(page, knowledgeBaseName, "the configured Knowledge Base");
  await clickExactText(page, parentPageName, "the configured meetings section");

  if (await findExistingPage(page, title)) {
    return "duplicate";
  }

  await clickExactText(page, "Добавить страницу", "the Add page control");
  await page.getByRole("button", { name: "Сохранить", exact: true }).waitFor({
    state: "visible",
    timeout: 15_000,
  });

  const editors = page.locator('[contenteditable="true"]');
  const editorCount = await editors.count();
  if (editorCount !== 2) {
    throw new Error(`Expected two page editors, found ${editorCount}; nothing was saved.`);
  }

  await editors.nth(0).fill(title);
  await editors.nth(1).fill(body);

  const actualTitle = normalizeText(await editors.nth(0).innerText());
  const actualBody = normalizeText(await editors.nth(1).innerText());
  if (actualTitle !== normalizeText(title) || actualBody !== normalizeText(body)) {
    throw new Error("The editor did not preserve the source text exactly; nothing was saved.");
  }

  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await page.getByText(title, { exact: true }).waitFor({ state: "visible", timeout: 30_000 });
  return "published";
}

async function processQueue({ dryRun, context, page }) {
  const state = await loadState();
  const entries = await listQueuedFiles();
  if (entries.length === 0) {
    log("No Markdown meeting files found in the GitHub publication queue.");
    return;
  }

  for (const entry of entries) {
    const prior = state.files[entry.path];
    if (prior?.sha === entry.sha) continue;

    const title = titleFromFile(entry.name);
    if (!title || title === "README") {
      log(`Skipped ${entry.name}: no usable page title.`);
      continue;
    }

    if (dryRun) {
      log(`Dry run: would create "${title}" from ${entry.path}.`);
      continue;
    }

    const body = await readQueuedFile(entry);
    const result = await publishPage(page, title, body);
    state.files[entry.path] = {
      sha: entry.sha,
      title,
      status: result,
      processedAt: new Date().toISOString(),
    };
    await saveState(state);
    log(result === "published"
      ? `Published "${title}" to the meetings section.`
      : `Skipped "${title}": a page with that exact title already exists.`);
  }
}

async function main() {
  if (args.has("--setup")) {
    await setupBrowserProfile();
    return;
  }

  const dryRun = !args.has("--publish");
  if (!dryRun && args.has("--dry-run")) {
    throw new Error("Choose either --dry-run or --publish, not both.");
  }

  let context;
  let page;
  try {
    if (!dryRun) {
      ({ context, page } = await openYouGile());
    }

    do {
      try {
        await processQueue({ dryRun, context, page });
      } catch (error) {
        log(error instanceof Error ? error.message : "Publisher cycle failed.");
        if (!args.has("--watch")) process.exitCode = 1;
      }
      if (!args.has("--watch")) break;
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    } while (true);
  } finally {
    if (context) await context.close();
  }
}

main().catch((error) => {
  log(error instanceof Error ? error.message : "Publisher failed.");
  process.exitCode = 1;
});
