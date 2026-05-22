import assert from "node:assert/strict";

import {
  appendArtStyleInstruction,
  boardAspectRatioOptions,
  boardArtStyleOptions,
  getAspectFromImageSize,
  getAvailableQualityOptions,
  getBoardAspectRatioSelection,
  getImageSizeForAspectQuality,
  getImageSizeForSourceAspect,
  getQualityFromImageSize,
} from "./board-ui-options";

assert.deepEqual(
  boardAspectRatioOptions.map((option) => option.value),
  ["auto", "21:9", "2:1", "16:9", "3:2", "4:3", "1:1", "4:5", "3:4", "2:3", "9:16", "1:2", "9:21"],
);
assert.deepEqual(
  boardAspectRatioOptions.map((option) => option.appIcon),
  ["Auto", "Ad", "We", "▶", "Cam", "Web", "IG", "RED", "Post", "Pin", "抖", "Ad", "St"],
);
assert.equal(boardAspectRatioOptions.every((option) => option.usageTitle.length > option.appIcon.length), true);
assert.deepEqual(
  boardAspectRatioOptions.map((option) => `${option.value}:${option.visualWidth}x${option.visualHeight}`),
  [
    "auto:16x12",
    "21:9:21x9",
    "2:1:20x10",
    "16:9:16x9",
    "3:2:18x12",
    "4:3:16x12",
    "1:1:15x15",
    "4:5:14x18",
    "3:4:13x18",
    "2:3:13x20",
    "9:16:12x21",
    "1:2:11x22",
    "9:21:10x23",
  ],
);

assert.equal(getImageSizeForAspectQuality("16:9", "1k"), "1536x864");
assert.equal(getImageSizeForAspectQuality("16:9", "2k"), "2048x1152");
assert.equal(getImageSizeForAspectQuality("16:9", "4k"), "3840x2160");
assert.equal(getImageSizeForAspectQuality("auto", "2k"), "2048x1152");
assert.equal(getImageSizeForSourceAspect({ width: 1200, height: 1800 }), "1200x1808");
assert.equal(getImageSizeForSourceAspect({ width: 1234, height: 1777 }), "1232x1776");
assert.equal(getImageSizeForSourceAspect({ width: 3000, height: 1000 }), "3008x1008");
assert.equal(getImageSizeForSourceAspect({ width: 5000, height: 5000 }), "2880x2880");

assert.equal(getImageSizeForAspectQuality("3:2", "1k"), "1536x1024");
assert.equal(getImageSizeForAspectQuality("3:2", "2k"), "2048x1360");
assert.equal(getImageSizeForAspectQuality("1:1", "1k"), "1024x1024");
assert.equal(getImageSizeForAspectQuality("1:1", "2k"), "2048x2048");
assert.equal(getImageSizeForAspectQuality("1:1", "4k"), "2880x2880");
assert.equal(getImageSizeForAspectQuality("4:5", "1k"), "1024x1280");
assert.equal(getImageSizeForAspectQuality("2:3", "2k"), "1360x2048");
assert.equal(getImageSizeForAspectQuality("1:2", "4k"), "1920x3840");

assert.equal(getAspectFromImageSize("2048x1152"), "16:9");
assert.equal(getAspectFromImageSize("1360x2048"), "2:3");
assert.equal(getAspectFromImageSize("1200x1800"), "auto");
assert.equal(getBoardAspectRatioSelection("auto"), "auto");
assert.equal(getBoardAspectRatioSelection("4:5"), "4:5");
assert.equal(getBoardAspectRatioSelection("2048x1152"), undefined);
assert.equal(getBoardAspectRatioSelection(undefined), undefined);
assert.equal(getQualityFromImageSize("2048x1152"), "2k");
assert.deepEqual(
  getAvailableQualityOptions("21:9").map((option) => option.value),
  ["1k", "4k"],
);
assert.deepEqual(
  getAvailableQualityOptions("auto").map((option) => option.value),
  ["2k"],
);
assert.equal(boardArtStyleOptions.every((option) => option.previewUrl.startsWith("/style-previews/")), true);
assert.equal(boardArtStyleOptions.every((option) => option.previewUrl.endsWith(".png")), true);

assert.equal(
  appendArtStyleInstruction("一座未来城市", "watercolor"),
  "一座未来城市\n\n画风要求：水彩质感，柔和颜料边缘，纸张肌理，清透层次。",
);
assert.equal(appendArtStyleInstruction("一座未来城市", "auto"), "一座未来城市");
