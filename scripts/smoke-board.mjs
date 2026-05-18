import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { hash } from "bcryptjs";
import { chromium } from "playwright";

const baseUrl = process.env.SMOKE_BASE_URL ?? "http://127.0.0.1:3333";
const dbPath = path.join(process.cwd(), "prisma", "dev.db");
const runId = `smoke-board-${Date.now()}`;
const username = `${runId}-user`;
const password = `${runId}-password`;
const userId = `${runId}-user-id`;
const boardId = `${runId}-board-id`;
const zeroDimensionAssetId = `${runId}-asset-1`;
const seededStoryboardObjectCount = 6;
const desktopAssetListSelector = '.control-panel [data-testid="asset-list"]';
const desktopAssetCardSelector = '.control-panel [data-testid="asset-card"]';
const pngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAEAAAAAwCAYAAAChS3wfAAAACXBIWXMAAAsTAAALEwEAmpwYAAACX0lEQVR4nO2ZTUsbURSGzz8Tu9D2F7T+CeOiKo0UEaV+gptqVq1NWqNSu7ItanTv105NoYW0iRTuLgsDgfk6coYEQjTpTGZu37nExQMhDJf3vPecO+eeIVVl7mcILQANoQWgIbQANIQWgIbQAtAQWgAaQgtAQ2gBaAgtAA2hBaAhtADjDbgqe/yh4PJoxuYX8zYPvbJ85Lf8ly24fF32Qq1ZuvF4d6vObxdrvDp3Gwh59nO+zr9K7v8xoFjxeDbv8OCExQMvuzM4bvHkO4cv/3iBgl9bCR74PSOWa/4aWg3YO3F5OP3vwNt5mrb462n3HZKd7zX4JrvbdX0GvD9w/R0NG3xrNmwcdjYhTNp3zIKlmh4D9k6iBd9qQqdMiBp8k9gNKFa8ntK+WzkUH6jVxBow/dGJLfgmM5uOGQZclb1Ap33oUpiw/MxKvAEbh27swTfJHrnJNyC1bmszYCxjJ9+A52/0GSAdY+INGI7x9G9H1u5rA55NGWDAyLy+EpC1E29Aqt8PwWxB32swd2zAa/BaUyP0xJRGSFWZZz7F3wrP5Q1phVXjMiQXmDhP/x83bI4Bqsq8fxFPKch1+NuZYddh1XIviDoQkRmizoHImq6BiGogw4xeykHS/vt593mdDDajGvBF50hMNfj5l3lhx/FP8iC7/jrrPFjz7chUVwabPe/+So1/6x6KqrbDUa60qYztd3XSNgvyW5qc3JF771UXaCy+Xfdne0EDl2dl58MErx4/jPDjlyGKWgKmQ2gBaAgtAA2hBaAhtAA0hBaAhtAC0BBaABpCC0BDaAFo7gDDeqFyavge7gAAAABJRU5ErkJggg==";

const db = new DatabaseSync(dbPath);
db.exec("PRAGMA busy_timeout = 10000");
let browser;

try {
  await seedSmokeData();

  browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: baseUrl });
  const page = await context.newPage();
  const consoleMessages = [];
  page.on("console", (message) => consoleMessages.push(`${message.type()}: ${message.text()}`));
  page.on("pageerror", (error) => consoleMessages.push(`pageerror: ${error.message}`));

  await login(page);

  await page.locator(".konva-board-canvas canvas").first().waitFor({ timeout: 30000 });
  await page.locator(".board-mode-rail").waitFor({ timeout: 30000 });
  const layout = await getBoardLayout(page);
  assertFixedViewportLayout(layout);
  assert(layout.canvasWidth > 500, `expected usable canvas width, layout=${JSON.stringify(layout)}`);
  assert(layout.canvasHeight > 400, `expected usable canvas height, layout=${JSON.stringify(layout)}`);
  assert(layout.canvasToolbarPosition === "absolute", `expected toolbar to be a floating canvas control, layout=${JSON.stringify(layout)}`);
  assert(layout.desktopSideAssetsDisplay === "none", `expected desktop side asset rail hidden in paged mode, layout=${JSON.stringify(layout)}`);
  assert(layout.desktopTabsDisplay === "grid", `expected desktop workspace tabs visible, layout=${JSON.stringify(layout)}`);
  assert(layout.desktopModeRailDisplay === "grid", `expected creative mode rail visible, layout=${JSON.stringify(layout)}`);
  assert(layout.desktopModeRailWorkspaceButtonCount === 0, `expected mode rail to contain canvas tools only, layout=${JSON.stringify(layout)}`);
  assert(layout.desktopGeneratePanelVisible, `expected generate page visible by default, layout=${JSON.stringify(layout)}`);
  assert(!layout.desktopEditPanelVisible, `expected edit page hidden by default, layout=${JSON.stringify(layout)}`);
  assert(!layout.desktopAssetsPanelVisible, `expected assets page hidden by default, layout=${JSON.stringify(layout)}`);

  await clickDesktopWorkspaceTab(page, "AI 生图");
  const generatePromptAssist = page.getByTestId("desktop-generate-prompt-assist");
  await generatePromptAssist.getByRole("button", { name: "辅助提示词" }).waitFor({ timeout: 30000 });
  await generatePromptAssist.getByLabel("图片类型").selectOption("poster");
  await generatePromptAssist.getByLabel("提示词辅助").selectOption("expand");

  await clickDesktopWorkspaceTab(page, "素材");
  await page.locator(desktopAssetListSelector).waitFor({ timeout: 30000 });
  const assetsLayout = await getBoardLayout(page);
  assert(assetsLayout.desktopAssetsPanelVisible, `expected assets page visible after tab switch, layout=${JSON.stringify(assetsLayout)}`);
  assert(!assetsLayout.desktopGeneratePanelVisible, `expected generate page hidden after asset tab switch, layout=${JSON.stringify(assetsLayout)}`);
  await clickDesktopWorkspaceTab(page, "分镜");
  await page.getByText("分镜脚本").waitFor({ timeout: 30000 });
  await page.getByRole("button", { name: "生成结构化分镜" }).waitFor({ timeout: 30000 });
  await assertStoryboardLayout(page, { mode: "desktop" });
  await assertStoryboardPromptActionHierarchy(page);
  await assertStoryboardFilters(page);
  await assertStoryboardDirtyState(page);
  await placeStoryboardCardsOnBoard(page);
  await clickDesktopWorkspaceTab(page, "AI 改图");
  const editLayout = await getBoardLayout(page);
  assert(editLayout.desktopEditSourcePanelVisible, `expected source image panel on edit tab, layout=${JSON.stringify(editLayout)}`);
  assert(editLayout.desktopEditPanelVisible, `expected edit settings visible on edit tab, layout=${JSON.stringify(editLayout)}`);
  assert(
    (await page.getByTestId("desktop-generate-prompt-assist").count()) === 0,
    "expected prompt assist button to stay out of AI edit tab",
  );
  await clickDesktopWorkspaceTab(page, "素材");
  await page.locator(desktopAssetListSelector).waitFor({ timeout: 30000 });

  const assetCount = await page.locator(desktopAssetListSelector).getAttribute("data-asset-count");
  assert(assetCount === "9", `expected all 9 assets to render, got ${assetCount}`);
  const cardCount = await page.locator(desktopAssetCardSelector).count();
  assert(cardCount === 9, `expected 9 rendered asset cards, got ${cardCount}`);
  await expectLoadedImages(page, `${desktopAssetCardSelector} img`, 9);
  const inlineAssetActionCount = await page.locator(`${desktopAssetCardSelector} .asset-actions button`).count();
  assert(inlineAssetActionCount === 0, `expected asset cards to show preview only, got ${inlineAssetActionCount} inline actions`);

  await page
    .locator(`${desktopAssetCardSelector}[data-asset-id="${zeroDimensionAssetId}"]`)
    .getByRole("button", { name: "预览素材" })
    .dispatchEvent("click");
  await page.getByRole("dialog").getByRole("button", { name: "载入" }).click();
  await expectObjectCount(page, seededStoryboardObjectCount + 1);
  await page.waitForTimeout(1300);

  const snapshotAfterSave = getBoardSnapshot();
  const savedObjectCount = getSavedObjectCount(snapshotAfterSave);
  assert(savedObjectCount === seededStoryboardObjectCount + 1, `expected autosaved object count ${seededStoryboardObjectCount + 1}, got ${savedObjectCount}`);
  const zeroDimensionObject = getSavedObjects(snapshotAfterSave).find(
    (object) => object.assetId === zeroDimensionAssetId,
  );
  assert(
    zeroDimensionObject?.w > 0 && zeroDimensionObject?.h > 0,
    `expected zero-dimension asset to load with visible object size, got ${JSON.stringify(zeroDimensionObject)}`,
  );
  await bindSelectedAssetToStoryboardFrames(page);

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator(".konva-board-canvas canvas").first().waitFor({ timeout: 30000 });
  await clickDesktopWorkspaceTab(page, "素材");
  await page.locator(desktopAssetListSelector).waitFor({ timeout: 30000 });
  await expectObjectCount(page, seededStoryboardObjectCount + 1);
  await expectLoadedImages(page, `${desktopAssetCardSelector} img`, 9);
  await clickDesktopWorkspaceTab(page, "AI 改图");
  const floatingToolbarLayout = await getBoardLayout(page);
  assert(floatingToolbarLayout.leftCanvasToolbarExists === false, `expected left canvas toolbar removed, layout=${JSON.stringify(floatingToolbarLayout)}`);
  assert(
    floatingToolbarLayout.bottomToolbarTop >= floatingToolbarLayout.titlebarBottom,
    `expected shortcut toolbar below the titlebar, layout=${JSON.stringify(floatingToolbarLayout)}`,
  );
  await page.getByLabel("快捷操作").getByRole("button", { name: "蒙版笔" }).click();
  await drawMaskStroke(page);
  await page.locator(".canvas-meta").getByText("已添加画布蒙版").waitFor({ timeout: 30000 });
  await page.getByLabel("快捷操作").getByRole("button", { name: "选择", exact: true }).click();
  await page.mouse.click(floatingToolbarLayout.canvasLeft + 150, floatingToolbarLayout.canvasTop + 130, { button: "right" });
  await page.getByRole("menuitem", { name: "复制图片" }).waitFor({ timeout: 30000 });
  await page.getByRole("menuitem", { name: "关闭" }).click();
  const maskSnapshot = await waitForSavedSnapshot((snapshot) => {
    const savedMaskState = snapshot?.app?.maskState;
    const savedSourceAssetId = snapshot?.app?.sourceAssetId;
    return (
      typeof savedSourceAssetId === "string" &&
      savedMaskState?.assetId === savedSourceAssetId &&
      Array.isArray(savedMaskState.strokes) &&
      savedMaskState.strokes.length === 1 &&
      savedMaskState.strokes[0].length >= 2
    );
  });
  const savedMaskState = maskSnapshot?.app?.maskState;
  const savedSourceAssetId = maskSnapshot?.app?.sourceAssetId;
  assert(
    typeof savedSourceAssetId === "string" &&
      savedMaskState?.assetId === savedSourceAssetId &&
      Array.isArray(savedMaskState.strokes) &&
      savedMaskState.strokes.length === 1 &&
      savedMaskState.strokes[0].length >= 2,
    `expected autosaved mask state for canvas toolbar stroke, got ${JSON.stringify(savedMaskState)}`,
  );

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator(".konva-board-canvas canvas").first().waitFor({ timeout: 30000 });
  const mobileLayout = await getBoardLayout(page);
  assertFixedViewportLayout(mobileLayout);
  assert(mobileLayout.canvasWidth >= 380, `expected mobile canvas to use viewport width, layout=${JSON.stringify(mobileLayout)}`);
  assert(mobileLayout.canvasHeight > 600, `expected usable mobile canvas height, layout=${JSON.stringify(mobileLayout)}`);
  assert(
    mobileLayout.desktopPanelDisplay === "" || mobileLayout.desktopPanelDisplay === "none",
    `expected desktop panel hidden on mobile, layout=${JSON.stringify(mobileLayout)}`,
  );
  assert(
    mobileLayout.assetPanelDisplay === "" || mobileLayout.assetPanelDisplay === "none",
    `expected asset panel hidden on mobile, layout=${JSON.stringify(mobileLayout)}`,
  );
  assert(mobileLayout.mobileTabbarDisplay === "grid", `expected mobile tabbar visible, layout=${JSON.stringify(mobileLayout)}`);
  assert(mobileLayout.mobileTabbarButtonCount === 6, `expected six mobile tabbar entries, layout=${JSON.stringify(mobileLayout)}`);
  assert(mobileLayout.mobileTabbarColumnCount === 6, `expected six mobile tabbar columns, layout=${JSON.stringify(mobileLayout)}`);
  assert(mobileLayout.mobileTabbarRowCount === 1, `expected mobile tabbar entries to stay on one row, layout=${JSON.stringify(mobileLayout)}`);
  await page.getByRole("navigation", { name: "移动端创作工具栏" }).getByRole("button", { name: "分镜", exact: true }).click();
  await page.getByText("分镜脚本").waitFor({ timeout: 30000 });
  await page.getByRole("button", { name: "生成结构化分镜" }).waitFor({ timeout: 30000 });
  await assertStoryboardLayout(page, { mode: "mobile" });
  await assertStoryboardPromptActionHierarchy(page);

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator(".konva-board-canvas canvas").first().waitFor({ timeout: 30000 });
  await mkdir(path.join(process.cwd(), "tmp"), { recursive: true });
  await page.screenshot({ path: path.join("tmp", "smoke-konva-board.png"), fullPage: true });
  await clickDesktopWorkspaceTab(page, "素材");
  await page.locator(desktopAssetListSelector).waitFor({ timeout: 30000 });

  await page
    .locator(desktopAssetCardSelector)
    .first()
    .getByRole("button", { name: "预览素材" })
    .dispatchEvent("click");
  const assetDialog = page.getByRole("dialog");
  await assetDialog.getByRole("button", { name: "载入" }).waitFor({ timeout: 30000 });
  await assetDialog.getByRole("button", { name: "源图" }).waitFor({ timeout: 30000 });
  await assetDialog.getByRole("button", { name: "参考" }).waitFor({ timeout: 30000 });
  await assetDialog.getByRole("button", { name: /下载/ }).waitFor({ timeout: 30000 });
  await assetDialog.getByRole("button", { name: "反推" }).waitFor({ timeout: 30000 });
  await assetDialog.getByRole("button", { name: "再推" }).waitFor({ timeout: 30000 });
  await assetDialog.getByRole("button", { name: "保存" }).waitFor({ timeout: 30000 });
  await assetDialog.getByRole("button", { name: "删除素材" }).waitFor({ timeout: 30000 });
  await assertElementWithinViewport(page, ".asset-preview-content");
  const download = page.waitForEvent("download");
  await assetDialog.getByRole("button", { name: /下载/ }).click();
  await download;
  await assetDialog.getByRole("button", { name: "参考" }).click();
  await assetDialog.getByRole("button", { name: "关闭" }).click();
  await clickDesktopWorkspaceTab(page, "AI 改图");
  await page.locator(".reference-prompt-pill").first().click();
  await page.getByRole("dialog").getByRole("button", { name: "复制提示词" }).waitFor({ timeout: 30000 });
  await assertElementWithinViewport(page, ".reverse-prompt-dialog");

  assert(
    consoleMessages.every((message) => !message.startsWith("pageerror:")),
    `unexpected page errors:\n${consoleMessages.join("\n")}`,
  );
  console.log(`konva board smoke passed: ${baseUrl}/boards/${boardId}`);
} finally {
  if (browser) await browser.close();
  cleanupDatabase();
  db.close();
}

async function seedSmokeData() {
  db.exec("PRAGMA foreign_keys = ON");
  const passwordHash = await hash(password, 12);
  db.prepare(
    `INSERT INTO "User" ("id", "username", "passwordHash", "name", "email", "role", "status", "approvedAt")
     VALUES (?, ?, ?, ?, ?, 'user', 'approved', CURRENT_TIMESTAMP)`,
  ).run(userId, username, passwordHash, username, `${username}@example.invalid`);
  db.prepare(`INSERT INTO "Board" ("id", "userId", "name") VALUES (?, ?, ?)`).run(
    boardId,
    userId,
    "Smoke Konva Board",
  );
  seedStoryboardProject();

  for (let index = 1; index <= 9; index += 1) {
    const assetId = `${runId}-asset-${index}`;
    const storageKey = `uploads/${boardId}/upload/${assetId}.png`;
    const absolutePath = path.join(process.cwd(), "public", storageKey);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, Buffer.from(pngBase64, "base64"));
    db.prepare(
      `INSERT INTO "Asset" ("id", "boardId", "kind", "storageKey", "publicUrl", "mimeType", "width", "height", "sizeBytes")
       VALUES (?, ?, 'upload', ?, ?, 'image/png', ?, ?, ?)`,
    ).run(
      assetId,
      boardId,
      storageKey,
      `/api/assets/${assetId}/file`,
      index === 1 ? 0 : 64,
      index === 1 ? 0 : 48,
      Buffer.byteLength(pngBase64, "base64"),
    );
  }
}

async function clickDesktopWorkspaceTab(page, name) {
  await page.getByRole("navigation", { name: "画板工具分页" }).getByRole("button", { name, exact: true }).click();
}

async function assertStoryboardLayout(page, { mode }) {
  const layout = await page.evaluate(() => {
    const viewportWidth = window.innerWidth;
    const shell = document.querySelector(".board-page-shell")?.getBoundingClientRect();
    const workbench = document.querySelector(".storyboard-workspace")?.getBoundingClientRect();
    const grid = document.querySelector(".storyboard-grid")?.getBoundingClientRect();
    const brief = document.querySelector(".storyboard-brief-panel")?.getBoundingClientRect();
    const shotList = document.querySelector(".storyboard-shot-list")?.getBoundingClientRect();
    const editor = document.querySelector(".storyboard-shot-editor")?.getBoundingClientRect();
    const headerActions = document.querySelector(".storyboard-header-actions")?.getBoundingClientRect();
    const shotListActions = document.querySelector(".storyboard-shot-list-actions")?.getBoundingClientRect();
    const headerButtons = Array.from(document.querySelectorAll(".storyboard-header-actions button")).map((button) => {
      const rect = button.getBoundingClientRect();
      return { height: rect.height, top: rect.top, width: rect.width };
    });
    const shotListActionButtons = Array.from(document.querySelectorAll(".storyboard-shot-list-actions button")).map((button) => {
      const rect = button.getBoundingClientRect();
      return { height: rect.height, top: rect.top, width: rect.width };
    });
    const headerActionsStyle = headerActions
      ? {
          alignItems: getComputedStyle(document.querySelector(".storyboard-header-actions")).alignItems,
          display: getComputedStyle(document.querySelector(".storyboard-header-actions")).display,
          flexDirection: getComputedStyle(document.querySelector(".storyboard-header-actions")).flexDirection,
          flexWrap: getComputedStyle(document.querySelector(".storyboard-header-actions")).flexWrap,
          gap: getComputedStyle(document.querySelector(".storyboard-header-actions")).gap,
          gridTemplateColumns: getComputedStyle(document.querySelector(".storyboard-header-actions")).gridTemplateColumns,
          justifyContent: getComputedStyle(document.querySelector(".storyboard-header-actions")).justifyContent,
        }
      : null;
    const gridElement = document.querySelector(".storyboard-grid");
    const gridColumns = gridElement ? getComputedStyle(gridElement).gridTemplateColumns : "";
    return {
      bodyScrollWidth: document.body.scrollWidth,
      brief,
      editor,
      grid,
      gridColumns,
      headerActions,
      headerActionsStyle,
      headerButtons,
      shell,
      shotListActionButtons,
      shotListActions,
      shotList,
      viewportWidth,
      workbench,
    };
  });
  const requiredRects = ["workbench", "grid", "brief", "shotList", "editor"];
  for (const key of requiredRects) {
    assert(layout[key], `expected storyboard ${key} to render in ${mode}, layout=${JSON.stringify(layout)}`);
    assert(layout[key].width > 0 && layout[key].height > 0, `expected storyboard ${key} to be visible in ${mode}, layout=${JSON.stringify(layout)}`);
    assert(layout[key].left >= -1, `expected storyboard ${key} not to overflow left in ${mode}, layout=${JSON.stringify(layout)}`);
    assert(layout[key].right <= layout.viewportWidth + 1, `expected storyboard ${key} not to overflow right in ${mode}, layout=${JSON.stringify(layout)}`);
  }
  assert(
    layout.bodyScrollWidth <= layout.viewportWidth + 1,
    `expected storyboard ${mode} layout without horizontal page overflow, layout=${JSON.stringify(layout)}`,
  );
  assert(layout.headerActions, `expected storyboard header actions to render in ${mode}, layout=${JSON.stringify(layout)}`);
  assert(layout.headerButtons.length === 4, `expected four storyboard header action buttons in ${mode}, layout=${JSON.stringify(layout)}`);
  assert(
    layout.headerActions.height <= 48,
    `expected compact storyboard header actions in ${mode}, layout=${JSON.stringify(layout)}`,
  );
  assert(
    new Set(layout.headerButtons.map((button) => Math.round(button.top))).size === 1,
    `expected storyboard header action buttons to stay on one row in ${mode}, layout=${JSON.stringify(layout)}`,
  );
  assert(layout.shotListActions, `expected storyboard shot list actions to render in ${mode}, layout=${JSON.stringify(layout)}`);
  assert(layout.shotListActionButtons.length === 4, `expected four storyboard shot list action buttons in ${mode}, layout=${JSON.stringify(layout)}`);
  assert(
    layout.shotListActionButtons.every((button) => button.width < 140 && button.height <= 40),
    `expected compact storyboard shot list actions in ${mode}, layout=${JSON.stringify(layout)}`,
  );
  if (mode === "mobile") {
    const columnCount = layout.gridColumns.split(" ").filter(Boolean).length;
    assert(columnCount === 1, `expected mobile storyboard grid to collapse to one column, layout=${JSON.stringify(layout)}`);
  }
}

async function assertStoryboardFilters(page) {
  await page.getByRole("button", { name: "全部 2" }).waitFor({ timeout: 30000 });
  await page.getByRole("button", { name: "缺提示词 1" }).click();
  const visibleShotItems = page.locator(".storyboard-shot-list > button");
  await expectLocatorCount(visibleShotItems, 1);
  await visibleShotItems.first().getByText("缺 2 项提示词").waitFor({ timeout: 30000 });
  await page.getByRole("button", { name: "全部 2" }).click();
  await expectLocatorCount(visibleShotItems, 2);
}

async function assertStoryboardPromptActionHierarchy(page) {
  await page.locator(".storyboard-prompt-action-row button.is-primary", { hasText: "生成缺失提示词" }).waitFor({ timeout: 30000 });
  await page.locator(".storyboard-prompt-action-row button.is-secondary", { hasText: "复制提示词包" }).waitFor({ timeout: 30000 });
  await page.locator(".storyboard-phase-badge").getByText("图片生成").waitFor({ timeout: 30000 });
  await expectFrameGenerationControls(page);
}

async function assertStoryboardDirtyState(page) {
  const titleInput = page.locator(".storyboard-brief-panel label", { hasText: "标题" }).locator("input");
  await titleInput.fill("未保存分镜测试");
  await page.getByText("有未保存修改").waitFor({ timeout: 30000 });
  await page.getByRole("button", { name: "保存*", exact: true }).waitFor({ timeout: 30000 });
}

async function placeStoryboardCardsOnBoard(page) {
  await page.getByRole("button", { name: "全部投放" }).click();
  await page.locator(".canvas-meta").getByText("6 个对象").waitFor({ timeout: 30000 });
  await page.waitForTimeout(1300);
  const snapshot = getBoardSnapshot();
  const objects = getSavedObjects(snapshot);
  const storyboardObjects = objects.filter((object) => typeof object.groupId === "string" && object.groupId.startsWith("storyboard:"));
  assert(storyboardObjects.length === 6, `expected two storyboard cards with six grouped objects, got ${JSON.stringify(storyboardObjects)}`);
  assert(
    storyboardObjects.some((object) => object.type === "text" && typeof object.text === "string" && object.text.includes("#1")),
    `expected storyboard card title text, got ${JSON.stringify(storyboardObjects)}`,
  );
}

async function bindSelectedAssetToStoryboardFrames(page) {
  const openDialogCloseButton = page.getByRole("dialog").getByRole("button", { name: "关闭" });
  if (await openDialogCloseButton.count()) {
    await openDialogCloseButton.click();
  }
  await clickDesktopWorkspaceTab(page, "分镜");
  await page.getByText("首尾帧素材").waitFor({ timeout: 30000 });
  await expectFrameGenerationControls(page);
  await page.getByRole("button", { name: "设为首帧" }).click();
  await page.getByText("已绑定首帧素材").waitFor({ timeout: 30000 });
  await page.getByRole("button", { name: "设为尾帧" }).click();
  await page.getByText("已绑定尾帧素材").waitFor({ timeout: 30000 });
  await expectLoadedImages(page, ".storyboard-frame-binding-preview img", 2);
  await page.getByRole("button", { name: "预览首帧素材" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "载入" }).waitFor({ timeout: 30000 });
  await assertElementWithinViewport(page, ".asset-preview-content");
  await page.getByRole("dialog").getByRole("button", { name: "关闭" }).click();
  await page.locator(".storyboard-frame-binding-control", { hasText: "首帧" }).getByRole("button", { name: "定位" }).click();
  await page.locator(".canvas-meta").getByText("已定位绑定素材").waitFor({ timeout: 30000 });
  await page.getByRole("button", { name: "复制提示词包" }).click();
  await page.getByText("已复制镜头提示词包").waitFor({ timeout: 30000 });
  const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
  assert(clipboardText.includes("# 镜头 1"), `expected copied prompt package heading, got ${clipboardText}`);
  assert(clipboardText.includes("## 首帧提示词"), `expected copied start-frame section, got ${clipboardText}`);
  assert(clipboardText.includes(zeroDimensionAssetId), `expected copied bound asset id, got ${clipboardText}`);
  const shot = db.prepare(
    `SELECT "startFrameAssetId", "endFrameAssetId" FROM "StoryboardShot" WHERE "id" = ?`,
  ).get(`${runId}-storyboard-shot-1`);
  assert(
    shot?.startFrameAssetId === zeroDimensionAssetId,
    `expected selected asset to bind as start frame, got ${JSON.stringify(shot)}`,
  );
  assert(
    shot?.endFrameAssetId === zeroDimensionAssetId,
    `expected selected asset to bind as end frame, got ${JSON.stringify(shot)}`,
  );
}

async function expectFrameGenerationControls(page) {
  await page.getByText("首尾帧生成").waitFor({ timeout: 30000 });
  const startButton = page.getByRole("button", { name: "生成首帧", exact: true });
  const endButton = page.getByRole("button", { name: "生成尾帧", exact: true });
  await startButton.waitFor({ timeout: 30000 });
  await endButton.waitFor({ timeout: 30000 });
  assert(!(await startButton.isDisabled()), "expected start-frame generation button to be enabled when prompt exists");
  assert(!(await endButton.isDisabled()), "expected end-frame generation button to be enabled when prompt exists");
  assert((await page.getByRole("button", { name: /生成视频/ }).count()) === 0, "expected video generation to stay out of Phase 2A");
}

async function login(page) {
  await page.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded", timeout: 30000 });
  const loginForm = page.locator(".login-form").first();
  await loginForm.locator('input[name="username"]').fill(username);
  await loginForm.locator('input[name="password"]').fill(password);
  await loginForm.locator('button[type="submit"]').click();
  await page.waitForURL(`${baseUrl}/boards/${boardId}`, { timeout: 30000 });
}

async function expectObjectCount(page, count) {
  await page
    .locator(".canvas-meta")
    .getByText(new RegExp(`${count} 个对象`))
    .waitFor({ timeout: 30000 });
}

async function expectLocatorCount(locator, count) {
  await locator.first().waitFor({ timeout: 30000 });
  const deadline = Date.now() + 30000;
  let actual = await locator.count();
  while (actual !== count && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    actual = await locator.count();
  }
  assert(actual === count, `expected locator count ${count}, got ${actual}`);
}

async function expectLoadedImages(page, selector, count) {
  await page.waitForFunction(
    ({ expectedCount, imageSelector }) => {
      const images = Array.from(document.querySelectorAll(imageSelector));
      return (
        images.length === expectedCount &&
        images.every((image) => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0)
      );
    },
    { expectedCount: count, imageSelector: selector },
    { timeout: 30000 },
  );
}

async function drawMaskStroke(page) {
  const canvasBox = await page.locator(".konva-board-canvas canvas").first().boundingBox();
  assert(canvasBox, "expected Konva canvas bounding box");
  await page.mouse.move(canvasBox.x + 170, canvasBox.y + 150);
  await page.mouse.down();
  await page.mouse.move(canvasBox.x + 230, canvasBox.y + 180, { steps: 8 });
  await page.mouse.up();
}

async function getBoardLayout(page) {
  return page.evaluate(() => {
    const shell = document.querySelector(".board-page-shell")?.getBoundingClientRect();
    const canvasArea = document.querySelector(".canvas-area")?.getBoundingClientRect();
    const canvas = document.querySelector(".konva-board-canvas")?.getBoundingClientRect();
    const toolbar = document.querySelector(".canvas-toolbar")?.getBoundingClientRect();
    const bottomToolbar = document.querySelector(".canvas-toolbar-bottom")?.getBoundingClientRect();
    const titlebar = document.querySelector(".board-window-titlebar")?.getBoundingClientRect();
    const meta = document.querySelector(".canvas-meta")?.getBoundingClientRect();
    const desktopPanel = document.querySelector(".desktop-panel");
    const assetPanel = document.querySelector(".board-page-shell > .asset-panel");
    const desktopModeRail = document.querySelector(".board-mode-rail");
    const desktopTabs = document.querySelector(".desktop-workspace-tabs");
    const desktopSideAssets = document.querySelector(".desktop-side-assets");
    const mobileTabbar = document.querySelector(".mobile-creator-tabbar");
    const mobileTabbarButtons = mobileTabbar ? Array.from(mobileTabbar.querySelectorAll("button")) : [];
    const mobileTabbarButtonTops = new Set(
      mobileTabbarButtons.map((button) => Math.round(button.getBoundingClientRect().top)),
    );
    const mobileTabbarColumns = mobileTabbar ? getComputedStyle(mobileTabbar).gridTemplateColumns : "";
    return {
      assetPanelDisplay: assetPanel ? getComputedStyle(assetPanel).display : "",
      bodyScrollHeight: document.body.scrollHeight,
      bodyScrollWidth: document.body.scrollWidth,
      bottomToolbarTop: bottomToolbar?.top ?? 0,
      canvasAreaHeight: canvasArea?.height ?? 0,
      canvasAreaWidth: canvasArea?.width ?? 0,
      canvasHeight: canvas?.height ?? 0,
      canvasLeft: canvas?.left ?? 0,
      canvasTop: canvas?.top ?? 0,
      canvasToolbarPosition: document.querySelector(".canvas-toolbar")
        ? getComputedStyle(document.querySelector(".canvas-toolbar")).position
        : "",
      canvasWidth: canvas?.width ?? 0,
      desktopAssetsPanelVisible: Boolean(document.querySelector('.desktop-view-panel-stack [data-testid="asset-list"]')),
      desktopEditPanelVisible: Boolean(
        Array.from(document.querySelectorAll(".desktop-view-panel-stack .section-title span")).some(
          (element) => element.textContent === "2. 改图设置",
        ),
      ),
      desktopEditSourcePanelVisible: Boolean(
        document.querySelector(".desktop-edit-source-summary"),
      ),
      desktopGeneratePanelVisible: Boolean(document.querySelector(".desktop-view-panel textarea[placeholder='描述你想要的画面内容、风格、细节等...']")),
      desktopModeRailDisplay: desktopModeRail ? getComputedStyle(desktopModeRail).display : "",
      desktopModeRailWorkspaceButtonCount: desktopModeRail
        ? Array.from(desktopModeRail.querySelectorAll("button")).filter((button) =>
            ["生图", "改图", "分镜", "素材"].includes(button.textContent?.trim() ?? ""),
          ).length
        : 0,
      desktopPanelDisplay: desktopPanel ? getComputedStyle(desktopPanel).display : "",
      desktopSideAssetsDisplay: desktopSideAssets ? getComputedStyle(desktopSideAssets).display : "",
      desktopTabsDisplay: desktopTabs ? getComputedStyle(desktopTabs).display : "",
      documentScrollHeight: document.documentElement.scrollHeight,
      documentScrollWidth: document.documentElement.scrollWidth,
      leftCanvasToolbarExists: Boolean(document.querySelector(".canvas-toolbar-left")),
      metaHeight: meta?.height ?? 0,
      mobileTabbarButtonCount: mobileTabbarButtons.length,
      mobileTabbarColumnCount: mobileTabbarColumns.split(" ").filter(Boolean).length,
      mobileTabbarDisplay: mobileTabbar ? getComputedStyle(mobileTabbar).display : "",
      mobileTabbarRowCount: mobileTabbarButtonTops.size,
      shellHeight: shell?.height ?? 0,
      shellWidth: shell?.width ?? 0,
      toolbarHeight: toolbar?.height ?? 0,
      titlebarBottom: titlebar?.bottom ?? 0,
      viewportHeight: window.innerHeight,
      viewportWidth: window.innerWidth,
    };
  });
}

function assertFixedViewportLayout(layout) {
  assert(
    layout.bodyScrollHeight <= layout.viewportHeight + 4 &&
      layout.documentScrollHeight <= layout.viewportHeight + 4,
    `expected fixed-height board shell without page scroll, layout=${JSON.stringify(layout)}`,
  );
  assert(
    layout.bodyScrollWidth <= layout.viewportWidth + 4 &&
      layout.documentScrollWidth <= layout.viewportWidth + 4,
    `expected fixed-width board shell without horizontal page scroll, layout=${JSON.stringify(layout)}`,
  );
}

async function assertElementWithinViewport(page, selector) {
  const box = await page.locator(selector).first().evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      bottom: rect.bottom,
      left: rect.left,
      right: rect.right,
      top: rect.top,
      viewportHeight: window.innerHeight,
      viewportWidth: window.innerWidth,
    };
  });
  assert(
    box.left >= 0 &&
      box.top >= 0 &&
      box.right <= box.viewportWidth &&
      box.bottom <= box.viewportHeight,
    `expected ${selector} within viewport, box=${JSON.stringify(box)}`,
  );
}

function getBoardSnapshot() {
  const row = db.prepare(`SELECT "snapshotJson" FROM "Board" WHERE "id" = ?`).get(boardId);
  return row?.snapshotJson ? JSON.parse(row.snapshotJson) : null;
}

async function waitForSavedSnapshot(predicate, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  let snapshot = getBoardSnapshot();
  while (!predicate(snapshot) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 150));
    snapshot = getBoardSnapshot();
  }
  return snapshot;
}

function getSavedObjectCount(snapshot) {
  return getSavedObjects(snapshot).length;
}

function getSavedObjects(snapshot) {
  return snapshot?.app?.boardDocument?.pages?.flatMap((page) =>
    Array.isArray(page.objects) ? page.objects : [],
  ) ?? [];
}

function seedStoryboardProject() {
  const projectId = `${runId}-storyboard-project`;
  db.prepare(
    `INSERT INTO "StoryboardProject" ("id", "boardId", "title", "briefJson", "scriptText", "createdAt", "updatedAt")
     VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
  ).run(
    projectId,
    boardId,
    "Smoke Storyboard",
    JSON.stringify({ targetPlatform: "douyin", contentType: "product", topic: "便携榨汁杯" }),
    "展示便携榨汁杯的使用场景。",
  );
  const shotStatement = db.prepare(
    `INSERT INTO "StoryboardShot" (
      "id", "projectId", "shotIndex", "durationSec", "scene", "camera", "action", "dialogue", "caption", "audio",
      "startFrameAssetId", "endFrameAssetId", "startFramePrompt", "endFramePrompt", "videoPrompt", "status", "metadataJson", "createdAt", "updatedAt"
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
  );
  shotStatement.run(
    `${runId}-storyboard-shot-1`,
    projectId,
    1,
    4,
    "厨房台面",
    "近景推入",
    "用户把水果放入杯中",
    "",
    "30 秒做一杯鲜榨果汁",
    "轻快音乐",
    null,
    null,
    "首帧提示词一",
    "尾帧提示词一",
    "视频提示词一",
    "prompts_ready",
    "{}",
  );
  shotStatement.run(
    `${runId}-storyboard-shot-2`,
    projectId,
    2,
    5,
    "户外桌面",
    "俯拍",
    "展示成品和便携收纳",
    "",
    "随身带走也方便",
    "轻快音乐",
    null,
    null,
    "首帧提示词二",
    "",
    "",
    "script_ready",
    "{}",
  );
}

function cleanupDatabase() {
  db.exec("PRAGMA foreign_keys = ON");
  db.prepare(`DELETE FROM "GenerationResult" WHERE "jobId" IN (SELECT "id" FROM "GenerationJob" WHERE "boardId" = ?)`).run(boardId);
  db.prepare(`DELETE FROM "GenerationJob" WHERE "boardId" = ?`).run(boardId);
  db.prepare(`DELETE FROM "BoardSnapshot" WHERE "boardId" = ?`).run(boardId);
  db.prepare(`DELETE FROM "Asset" WHERE "boardId" = ?`).run(boardId);
  db.prepare(`DELETE FROM "StoryboardShot" WHERE "projectId" IN (SELECT "id" FROM "StoryboardProject" WHERE "boardId" = ?)`).run(boardId);
  db.prepare(`DELETE FROM "StoryboardProject" WHERE "boardId" = ?`).run(boardId);
  db.prepare(`DELETE FROM "Board" WHERE "id" = ?`).run(boardId);
  db.prepare(`DELETE FROM "Session" WHERE "userId" = ?`).run(userId);
  db.prepare(`DELETE FROM "Account" WHERE "userId" = ?`).run(userId);
  db.prepare(`DELETE FROM "ProviderSetting" WHERE "userId" = ?`).run(userId);
  db.prepare(`DELETE FROM "User" WHERE "id" = ?`).run(userId);
  const uploadTarget = path.join(process.cwd(), "public", "uploads", boardId);
  void rm(uploadTarget, { force: true, recursive: true });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

