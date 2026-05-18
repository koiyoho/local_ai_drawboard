export const platformPresetIds = [
  "douyin",
  "xiaohongshu",
  "wechat_channels",
  "tiktok",
  "youtube_shorts",
  "instagram_reels",
] as const;

export type PlatformPresetId = (typeof platformPresetIds)[number];
export type PlatformLocale = "zh-CN" | "en-US" | "bilingual";

export type PlatformCopywritingPreset = {
  id: PlatformPresetId;
  label: string;
  locale: PlatformLocale;
  hookGuidance: string;
  captionGuidance: string;
  ctaGuidance: string;
  storyboardGuidance: string;
  visualGuidance: string;
  complianceNotes: string[];
};

export const platformCopywritingPresets: Record<PlatformPresetId, PlatformCopywritingPreset> = {
  douyin: {
    id: "douyin",
    label: "抖音",
    locale: "zh-CN",
    hookGuidance: "开头 1 秒直接给痛点、反差、结果或高能动作，避免铺垫。",
    captionGuidance: "字幕短、强节奏、口语化，每条字幕承载一个信息点。",
    ctaGuidance: "CTA 直接但不过度承诺，可引导评论、收藏、私信或点击购买。",
    storyboardGuidance: "适合痛点-解决-证明-转化结构，镜头密度高，前三镜要建立冲突和结果预期。",
    visualGuidance: "竖屏 9:16，动作先行，主体大，文字层级强，画面反馈明确。",
    complianceNotes: ["避免绝对化用语", "避免医疗、金融、功效类夸大承诺"],
  },
  xiaohongshu: {
    id: "xiaohongshu",
    label: "小红书",
    locale: "zh-CN",
    hookGuidance: "开头强调真实体验、使用场景或人群共鸣，减少硬广感。",
    captionGuidance: "字幕像笔记口吻，强调体验、细节、前后对比和避坑。",
    ctaGuidance: "CTA 偏收藏、评论、同款、清单，不宜过硬。",
    storyboardGuidance: "适合种草、测评、清单、前后对比，镜头要呈现体验证据。",
    visualGuidance: "画面干净、有生活方式质感，保留真实使用痕迹和细节特写。",
    complianceNotes: ["避免虚假体验", "避免无依据的功效承诺"],
  },
  wechat_channels: {
    id: "wechat_channels",
    label: "视频号",
    locale: "zh-CN",
    hookGuidance: "开头清楚交代主题和价值，适合稍稳的解释型表达。",
    captionGuidance: "字幕可稍完整，适合知识点、品牌说明和场景价值。",
    ctaGuidance: "CTA 适合关注、转发、预约、咨询或进入私域。",
    storyboardGuidance: "适合品牌可信度、知识讲解、产品价值和私域转化。",
    visualGuidance: "画面稳定、信息清晰，品牌和人物可信度优先。",
    complianceNotes: ["避免诱导分享的违规表达", "注意行业敏感词"],
  },
  tiktok: {
    id: "tiktok",
    label: "TikTok",
    locale: "en-US",
    hookGuidance: "Use a visible action or result in the first 1-2 seconds. Avoid slow setup.",
    captionGuidance: "Captions should be short, punchy, and easy to read while the video moves.",
    ctaGuidance: "Use simple CTAs such as try it, save this, watch this, or comment your use case.",
    storyboardGuidance: "Strong hook, fast demonstration, visual payoff, quick social proof, clear CTA.",
    visualGuidance: "Vertical 9:16, motion-first framing, close-ups, clear before/after or problem/solution contrast.",
    complianceNotes: ["Avoid unverifiable performance claims", "Avoid restricted health or finance claims"],
  },
  youtube_shorts: {
    id: "youtube_shorts",
    label: "YouTube Shorts",
    locale: "en-US",
    hookGuidance: "Open with a clear promise or surprising result, then sustain retention through steps.",
    captionGuidance: "Captions can be slightly more explanatory than TikTok but must stay compact.",
    ctaGuidance: "CTA can ask viewers to subscribe, watch the next part, or save the tip.",
    storyboardGuidance: "Works well for mini tutorial, reveal, ranked list, product demo, and explainers.",
    visualGuidance: "Use clear progress markers, readable overlays, and strong thumbnail-like first frame.",
    complianceNotes: ["Avoid misleading thumbnails or claims", "Keep claims supportable"],
  },
  instagram_reels: {
    id: "instagram_reels",
    label: "Instagram Reels",
    locale: "en-US",
    hookGuidance: "Lead with lifestyle, transformation, or visual taste. Keep copy polished and minimal.",
    captionGuidance: "Captions should feel premium, concise, and visually balanced.",
    ctaGuidance: "CTA should feel brand-safe: save, share, shop, learn more, or discover.",
    storyboardGuidance: "Works well for lifestyle product, brand story, mood sequence, and visual transformation.",
    visualGuidance: "Prioritize clean composition, aspirational visuals, color consistency, and tactile detail.",
    complianceNotes: ["Avoid overclaiming", "Keep brand and usage claims accurate"],
  },
};

export function getPlatformPreset(id: PlatformPresetId | string | undefined): PlatformCopywritingPreset {
  return isPlatformPresetId(id) ? platformCopywritingPresets[id] : platformCopywritingPresets.douyin;
}

export function isPlatformPresetId(value: unknown): value is PlatformPresetId {
  return typeof value === "string" && platformPresetIds.includes(value as PlatformPresetId);
}
