import { useEffect, useMemo, useState } from "react";

import { apiJson } from "@/client/api";
import { apiUrl } from "@/lib/api-client";
import type { AssetPayload, JobPayload, StoryboardBriefPayload, StoryboardProjectPayload, StoryboardShotPayload } from "@/components/board-canvas/types";
import {
  getStoryboardStatusLabel,
  storyboardContentTypeOptions,
  storyboardPlatformOptions,
  storyboardStatusOptions,
} from "./storyboard-ui";

type StoryboardWorkspaceProps = {
  boardId: string;
  initialStoryboard: StoryboardProjectPayload | null;
  onFocusAssetOnBoard?: (assetId: string) => void;
  onStoryboardChange: (storyboard: StoryboardProjectPayload | null) => void;
  onPlaceAllShotsOnBoard?: (shots: StoryboardShotPayload[]) => void;
  onPlaceShotOnBoard?: (shot: StoryboardShotPayload) => void;
  onPreviewAsset?: (asset: AssetPayload) => void;
  onFrameGenerationComplete?: (payload: { asset: AssetPayload; job: JobPayload; shot: StoryboardShotPayload }) => void;
  imageAssets?: AssetPayload[];
  selectedCanvasAsset?: Pick<AssetPayload, "height" | "id" | "kind" | "publicUrl" | "width"> | null;
};

type GenerateFrameResponse = {
  asset: AssetPayload;
  frame: "end" | "start";
  job: JobPayload;
  shot: StoryboardShotPayload;
};

type BriefDraft = Partial<StoryboardBriefPayload>;
type ShotDraft = StoryboardShotPayload;
type PromptField = "startFramePrompt" | "endFramePrompt" | "videoPrompt";
type ShotFilter = "all" | "missing_prompts" | string;

export function StoryboardWorkspace({
  boardId,
  initialStoryboard,
  onFocusAssetOnBoard,
  onStoryboardChange,
  onPlaceAllShotsOnBoard,
  onPlaceShotOnBoard,
  onPreviewAsset,
  onFrameGenerationComplete,
  imageAssets = [],
  selectedCanvasAsset,
}: StoryboardWorkspaceProps) {
  const [storyboard, setStoryboard] = useState<StoryboardProjectPayload | null>(initialStoryboard);
  const [brief, setBrief] = useState<BriefDraft>(initialStoryboard?.brief ?? { targetPlatform: "douyin" });
  const [scriptText, setScriptText] = useState(initialStoryboard?.scriptText ?? "");
  const [title, setTitle] = useState(initialStoryboard?.title ?? "");
  const [shotDrafts, setShotDrafts] = useState<Record<string, ShotDraft>>({});
  const [selectedShotId, setSelectedShotId] = useState(initialStoryboard?.shots[0]?.id ?? "");
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [shotFilter, setShotFilter] = useState<ShotFilter>("all");

  useEffect(() => {
    setStoryboard(initialStoryboard);
    setBrief(initialStoryboard?.brief ?? { targetPlatform: "douyin" });
    setScriptText(initialStoryboard?.scriptText ?? "");
    setTitle(initialStoryboard?.title ?? "");
    setShotDrafts(Object.fromEntries((initialStoryboard?.shots ?? []).map((shot) => [shot.id, shot])));
    setSelectedShotId(initialStoryboard?.shots[0]?.id ?? "");
  }, [initialStoryboard]);

  const shots = useMemo(
    () => (storyboard?.shots ?? []).map((shot) => shotDrafts[shot.id] ?? shot),
    [shotDrafts, storyboard?.shots],
  );
  const shotStats = useMemo(() => getShotStats(shots), [shots]);
  const visibleShots = useMemo(() => getFilteredShots(shots, shotFilter), [shotFilter, shots]);
  const selectedShot = shots.find((shot) => shot.id === selectedShotId) ?? shots[0] ?? null;
  const savedSelectedShot = storyboard?.shots.find((shot) => shot.id === selectedShot?.id) ?? null;
  const assetById = useMemo(() => new Map(imageAssets.map((asset) => [asset.id, asset])), [imageAssets]);
  const isProjectDirty = storyboard
    ? title !== storyboard.title ||
      scriptText !== storyboard.scriptText ||
      JSON.stringify(normalizeBriefDraft(brief)) !== JSON.stringify(normalizeBriefDraft(storyboard.brief))
    : title.trim() !== "" || scriptText.trim() !== "" || hasBriefDraftContent(brief);
  const isSelectedShotDirty = Boolean(selectedShot && savedSelectedShot && !areShotsEqual(selectedShot, savedSelectedShot));
  const hasUnsavedChanges = isProjectDirty || isSelectedShotDirty;

  function updateStoryboard(next: StoryboardProjectPayload) {
    setStoryboard(next);
    setShotDrafts(Object.fromEntries(next.shots.map((shot) => [shot.id, shot])));
    setSelectedShotId((current) => next.shots.some((shot) => shot.id === current) ? current : next.shots[0]?.id ?? "");
    onStoryboardChange(next);
  }

  function replaceShotDraft(shot: StoryboardShotPayload) {
    setShotDrafts((current) => ({ ...current, [shot.id]: shot }));
    if (storyboard) {
      const next = {
        ...storyboard,
        shots: storyboard.shots.map((item) => (item.id === shot.id ? shot : item)),
      };
      setStoryboard(next);
      onStoryboardChange(next);
    }
  }

  function patchSelectedShotDraft(patch: Partial<StoryboardShotPayload>) {
    if (!selectedShot) return;
    setShotDrafts((current) => ({
      ...current,
      [selectedShot.id]: { ...selectedShot, ...patch },
    }));
  }

  function patchSelectedPromptLock(field: PromptField, locked: boolean) {
    if (!selectedShot) return;
    patchSelectedShotDraft({
      metadata: {
        ...selectedShot.metadata,
        promptLocks: {
          ...getPromptLocks(selectedShot),
          [field]: locked,
        },
      },
    });
  }

  function selectShot(shotId: string) {
    if (shotId === selectedShotId) return;
    if (isSelectedShotDirty && !window.confirm("当前镜头有未保存修改，切换镜头会保留在本地但不会写入数据库。是否继续切换？")) {
      return;
    }
    setSelectedShotId(shotId);
  }

  function applyShotFilter(nextFilter: ShotFilter) {
    if (nextFilter === shotFilter) return;
    const nextShots = getFilteredShots(shots, nextFilter);
    const nextSelectedShotId = nextShots.some((shot) => shot.id === selectedShotId)
      ? selectedShotId
      : nextShots[0]?.id ?? selectedShotId;
    if (nextSelectedShotId !== selectedShotId && isSelectedShotDirty && !window.confirm("当前镜头有未保存修改，筛选会切换到其他镜头。是否继续？")) {
      return;
    }
    setShotFilter(nextFilter);
    if (nextSelectedShotId !== selectedShotId) {
      setSelectedShotId(nextSelectedShotId);
    }
  }

  async function runAction(action: () => Promise<void>) {
    if (isBusy) return;
    setIsBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "操作失败");
    } finally {
      setIsBusy(false);
    }
  }

  function saveStoryboard() {
    runAction(async () => {
      const payload = await apiJson<{ storyboard: StoryboardProjectPayload }>(`/api/boards/${boardId}/storyboard`, {
        body: JSON.stringify({ brief, scriptText, title }),
        method: "PUT",
      });
      setBrief(payload.storyboard.brief);
      setScriptText(payload.storyboard.scriptText);
      setTitle(payload.storyboard.title);
      updateStoryboard(payload.storyboard);
      setNotice("分镜项目已保存");
    });
  }

  function generateStoryboard() {
    runAction(async () => {
      const payload = await apiJson<{ storyboard: StoryboardProjectPayload }>(`/api/boards/${boardId}/storyboard/generate`, {
        body: JSON.stringify({ brief, scriptText, title }),
        method: "POST",
      });
      setBrief(payload.storyboard.brief);
      setScriptText(payload.storyboard.scriptText);
      setTitle(payload.storyboard.title);
      updateStoryboard(payload.storyboard);
      setNotice("已生成结构化分镜");
    });
  }

  function createShot() {
    runAction(async () => {
      const payload = await apiJson<{ shot: StoryboardShotPayload }>(`/api/boards/${boardId}/storyboard/shots`, {
        body: JSON.stringify({ action: "", caption: "" }),
        method: "POST",
      });
      const next = await apiJson<{ storyboard: StoryboardProjectPayload }>(`/api/boards/${boardId}/storyboard`);
      updateStoryboard(next.storyboard);
      setSelectedShotId(payload.shot.id);
    });
  }

  function saveSelectedShot() {
    if (!selectedShot) return;
    runAction(async () => {
      const payload = await apiJson<{ shot: StoryboardShotPayload }>(`/api/boards/${boardId}/storyboard/shots/${selectedShot.id}`, {
        body: JSON.stringify(selectedShot),
        method: "PATCH",
      });
      replaceShotDraft(payload.shot);
      setNotice("镜头已保存");
    });
  }

  function bindSelectedShotFrameAsset(field: "endFrameAssetId" | "startFrameAssetId") {
    if (!selectedShot) return;
    if (!selectedCanvasAsset) {
      setNotice("请先在画布中选中一张图片素材");
      return;
    }
    setSelectedShotFrameAsset(field, selectedCanvasAsset.id);
  }

  function setSelectedShotFrameAsset(field: "endFrameAssetId" | "startFrameAssetId", assetId: string | null) {
    if (!selectedShot) return;
    runAction(async () => {
      const payload = await apiJson<{ shot: StoryboardShotPayload }>(`/api/boards/${boardId}/storyboard/shots/${selectedShot.id}`, {
        body: JSON.stringify({ ...selectedShot, [field]: assetId }),
        method: "PATCH",
      });
      replaceShotDraft(payload.shot);
      setNotice(assetId ? (field === "startFrameAssetId" ? "已绑定首帧素材" : "已绑定尾帧素材") : "已清除帧素材绑定");
    });
  }

  function duplicateShot(shotId: string) {
    runAction(async () => {
      const payload = await apiJson<{ shot: StoryboardShotPayload }>(`/api/boards/${boardId}/storyboard/shots/${shotId}/duplicate`, {
        method: "POST",
      });
      const next = await apiJson<{ storyboard: StoryboardProjectPayload }>(`/api/boards/${boardId}/storyboard`);
      updateStoryboard(next.storyboard);
      setSelectedShotId(payload.shot.id);
    });
  }

  function deleteShot(shotId: string) {
    runAction(async () => {
      const payload = await apiJson<{ storyboard: StoryboardProjectPayload }>(`/api/boards/${boardId}/storyboard/shots/${shotId}`, {
        method: "DELETE",
      });
      updateStoryboard(payload.storyboard);
      setSelectedShotId(payload.storyboard.shots[0]?.id ?? "");
    });
  }

  function moveShot(shotId: string, direction: -1 | 1) {
    if (!storyboard) return;
    const index = storyboard.shots.findIndex((shot) => shot.id === shotId);
    const targetIndex = index + direction;
    if (index < 0 || targetIndex < 0 || targetIndex >= storyboard.shots.length) return;
    const nextShots = [...storyboard.shots];
    const [shot] = nextShots.splice(index, 1);
    nextShots.splice(targetIndex, 0, shot);
    runAction(async () => {
      const payload = await apiJson<{ storyboard: StoryboardProjectPayload }>(`/api/boards/${boardId}/storyboard/shots/reorder`, {
        body: JSON.stringify({ orderedShotIds: nextShots.map((item) => item.id) }),
        method: "POST",
      });
      updateStoryboard(payload.storyboard);
    });
  }

  function generateShotPrompts(shotId: string, overwrite = false) {
    runAction(async () => {
      const payload = await apiJson<{ shot: StoryboardShotPayload }>(`/api/boards/${boardId}/storyboard/shots/${shotId}/generate-prompts`, {
        body: JSON.stringify({ overwrite }),
        method: "POST",
      });
      replaceShotDraft(payload.shot);
      setNotice(overwrite ? "已重生成未锁定提示词" : "已生成首帧、尾帧和视频提示词");
    });
  }

  function generateStoryboardPrompts(overwrite = false) {
    const unsavedMessage = overwrite
      ? "当前有未保存修改。批量重生成会基于已保存的分镜内容，并覆盖未锁定提示词，是否继续？"
      : "当前有未保存修改。批量补齐会基于已保存的分镜内容生成提示词，是否继续？";
    if (hasUnsavedChanges && !window.confirm(unsavedMessage)) {
      return;
    }
    runAction(async () => {
      const payload = await apiJson<{ storyboard: StoryboardProjectPayload; updatedCount: number }>(`/api/boards/${boardId}/storyboard/shots/generate-prompts`, {
        body: JSON.stringify({ overwrite }),
        method: "POST",
      });
      updateStoryboard(payload.storyboard);
      const actionText = overwrite ? "重生成" : "补齐";
      setNotice(payload.updatedCount > 0 ? `已${actionText} ${payload.updatedCount} 个镜头提示词` : `没有需要${actionText}的提示词`);
    });
  }

  function generateShotFrame(frame: "end" | "start") {
    if (!selectedShot) return;
    const prompt = frame === "start" ? selectedShot.startFramePrompt : selectedShot.endFramePrompt;
    if (!prompt.trim()) {
      setNotice(frame === "start" ? "请先生成或填写首帧提示词" : "请先生成或填写尾帧提示词");
      return;
    }
    runAction(async () => {
      const payload = await apiJson<GenerateFrameResponse>(`/api/boards/${boardId}/storyboard/shots/${selectedShot.id}/generate-frame`, {
        body: JSON.stringify({ frame }),
        method: "POST",
      });
      replaceShotDraft(payload.shot);
      onFrameGenerationComplete?.({ asset: payload.asset, job: payload.job, shot: payload.shot });
      setNotice(frame === "start" ? "已生成并绑定首帧" : "已生成并绑定尾帧");
    });
  }

  async function copyPromptText(label: string, value: string) {
    if (!value.trim()) {
      setNotice(`${label}为空`);
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
      setNotice(`已复制${label}`);
    } catch {
      setError("复制失败，请手动选择文本复制");
    }
  }

  async function copySelectedShotPromptPackage() {
    if (!selectedShot) return;
    const packageText = buildShotPromptPackage(selectedShot, assetById);
    try {
      await navigator.clipboard.writeText(packageText);
      setNotice("已复制镜头提示词包");
    } catch {
      setError("复制失败，请手动选择文本复制");
    }
  }

  function exportStoryboard(format: "md" | "json" | "csv") {
    window.open(apiUrl(`/api/boards/${boardId}/storyboard/export.${format}`), "_blank", "noopener,noreferrer");
  }

  return (
    <section className="storyboard-workspace">
      <header className="storyboard-header">
        <div className="storyboard-header-title">
          <strong>分镜脚本</strong>
          <span>{hasUnsavedChanges ? "有未保存修改" : "文案结构化、分镜编辑、首尾帧与视频提示词"}</span>
        </div>
        <div className="storyboard-header-actions">
          <button className="storyboard-export-button" disabled={!storyboard} onClick={() => exportStoryboard("md")} type="button">MD</button>
          <button className="storyboard-export-button" disabled={!storyboard} onClick={() => exportStoryboard("json")} type="button">JSON</button>
          <button className="storyboard-export-button" disabled={!storyboard} onClick={() => exportStoryboard("csv")} type="button">CSV</button>
          <button className="storyboard-save-button" disabled={isBusy} onClick={saveStoryboard} type="button">{isProjectDirty ? "保存*" : "保存"}</button>
        </div>
      </header>

      {error ? <p className="generation-result-hint error">{error}</p> : null}
      {notice ? <p className="generation-result-hint success">{notice}</p> : null}

      <div className="storyboard-grid">
        <section className="storyboard-brief-panel">
          <label>标题<input value={title} onChange={(event) => setTitle(event.target.value)} /></label>
          <label>平台<select value={brief.targetPlatform ?? "douyin"} onChange={(event) => setBrief({ ...brief, targetPlatform: event.target.value })}>
            {storyboardPlatformOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select></label>
          <label>类型<select value={brief.contentType ?? "product"} onChange={(event) => setBrief({ ...brief, contentType: event.target.value })}>
            {storyboardContentTypeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select></label>
          <label>主题<input value={brief.topic ?? ""} onChange={(event) => setBrief({ ...brief, topic: event.target.value })} /></label>
          <label>受众<input value={brief.audience ?? ""} onChange={(event) => setBrief({ ...brief, audience: event.target.value })} /></label>
          <label>卖点<textarea value={brief.sellingPoints ?? ""} onChange={(event) => setBrief({ ...brief, sellingPoints: event.target.value })} /></label>
          <label>限制<textarea value={brief.constraints ?? ""} onChange={(event) => setBrief({ ...brief, constraints: event.target.value })} /></label>
          <label>原始文案<textarea value={scriptText} onChange={(event) => setScriptText(event.target.value)} /></label>
          <button disabled={isBusy || !scriptText.trim()} onClick={generateStoryboard} type="button">生成结构化分镜</button>
        </section>

        <section className="storyboard-shot-list">
          <div className="storyboard-shot-list-header">
            <strong>镜头</strong>
            <div className="storyboard-shot-list-actions">
              <button disabled={shots.length === 0 || !onPlaceAllShotsOnBoard} onClick={() => onPlaceAllShotsOnBoard?.(shots)} type="button">全部投放</button>
              <button disabled={isBusy || shots.length === 0} onClick={() => generateStoryboardPrompts(false)} type="button">补齐提示词</button>
              <button disabled={isBusy || shots.length === 0} onClick={() => generateStoryboardPrompts(true)} type="button">重生成</button>
              <button disabled={isBusy} onClick={createShot} type="button">新增</button>
            </div>
          </div>
          <div className="storyboard-shot-stats" aria-label="分镜状态筛选">
            <button aria-pressed={shotFilter === "all"} onClick={() => applyShotFilter("all")} type="button">全部 {shots.length}</button>
            <button aria-pressed={shotFilter === "missing_prompts"} onClick={() => applyShotFilter("missing_prompts")} type="button">缺提示词 {shotStats.missingPrompts}</button>
            {storyboardStatusOptions.map((option) => (
              <button
                aria-pressed={shotFilter === option.value}
                disabled={(shotStats.byStatus[option.value] ?? 0) === 0}
                key={option.value}
                onClick={() => applyShotFilter(option.value)}
                type="button"
              >
                {option.label} {shotStats.byStatus[option.value] ?? 0}
              </button>
            ))}
          </div>
          {visibleShots.map((shot) => (
            <button
              className={shot.id === selectedShot?.id ? "is-active" : ""}
              key={shot.id}
              onClick={() => selectShot(shot.id)}
              type="button"
            >
              <span>{shot.shotIndex}. {shot.caption || shot.action || "未命名镜头"}</span>
              <em>
                {shot.durationSec}s · {getStoryboardStatusLabel(shot.status)}
                {getMissingPromptCount(shot) > 0 ? ` · 缺 ${getMissingPromptCount(shot)} 项提示词` : " · 提示词完整"}
              </em>
            </button>
          ))}
          {shots.length === 0 ? <p className="muted">暂无镜头</p> : null}
          {shots.length > 0 && visibleShots.length === 0 ? <p className="muted">当前筛选下没有镜头</p> : null}
        </section>

        <section className="storyboard-shot-editor">
          {selectedShot ? (
            <>
              <div className="storyboard-shot-actions">
                <button disabled={selectedShot.shotIndex <= 1 || isBusy} onClick={() => moveShot(selectedShot.id, -1)} type="button">上移</button>
                <button disabled={selectedShot.shotIndex >= shots.length || isBusy} onClick={() => moveShot(selectedShot.id, 1)} type="button">下移</button>
                <button className={isSelectedShotDirty ? "storyboard-dirty-action" : ""} disabled={isBusy} onClick={saveSelectedShot} type="button">{isSelectedShotDirty ? "保存镜头*" : "保存镜头"}</button>
                <button disabled={!onPlaceShotOnBoard} onClick={() => onPlaceShotOnBoard?.(selectedShot)} type="button">投到画板</button>
                <button disabled={isBusy} onClick={() => duplicateShot(selectedShot.id)} type="button">复制</button>
                <button disabled={isBusy} onClick={() => deleteShot(selectedShot.id)} type="button">删除</button>
              </div>
              {isSelectedShotDirty ? <p className="storyboard-unsaved-hint">当前镜头有未保存修改</p> : null}
              <label>状态<select value={selectedShot.status} onChange={(event) => patchSelectedShotDraft({ status: event.target.value })}>
                {storyboardStatusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select></label>
              <label>时长<input type="number" min="1" value={selectedShot.durationSec} onChange={(event) => patchSelectedShotDraft({ durationSec: Number(event.target.value) })} /></label>
              <label>场景<textarea value={selectedShot.scene} onChange={(event) => patchSelectedShotDraft({ scene: event.target.value })} /></label>
              <label>机位<textarea value={selectedShot.camera} onChange={(event) => patchSelectedShotDraft({ camera: event.target.value })} /></label>
              <label>动作<textarea value={selectedShot.action} onChange={(event) => patchSelectedShotDraft({ action: event.target.value })} /></label>
              <label>台词<textarea value={selectedShot.dialogue} onChange={(event) => patchSelectedShotDraft({ dialogue: event.target.value })} /></label>
              <label>字幕<textarea value={selectedShot.caption} onChange={(event) => patchSelectedShotDraft({ caption: event.target.value })} /></label>
              <div className="storyboard-prompt-action-row">
                <button className="is-primary" disabled={isBusy} onClick={() => generateShotPrompts(selectedShot.id, false)} type="button">生成缺失提示词</button>
                <button disabled={isBusy} onClick={() => generateShotPrompts(selectedShot.id, true)} type="button">重生成未锁定</button>
                <button className="is-secondary" disabled={isBusy} onClick={copySelectedShotPromptPackage} type="button">复制提示词包</button>
              </div>
              <div className="storyboard-frame-binding" aria-label="首尾帧素材绑定">
                <div>
                  <strong>首尾帧素材</strong>
                  <span>
                    {selectedCanvasAsset
                      ? `当前选中：${getAssetKindLabel(selectedCanvasAsset.kind)} ${formatAssetSize(selectedCanvasAsset)}`
                      : "在画布选中图片后可绑定"}
                  </span>
                </div>
                <div className="storyboard-frame-binding-grid">
                  <FrameBindingControl
                    asset={selectedShot.startFrameAssetId ? assetById.get(selectedShot.startFrameAssetId) ?? null : null}
                    assetId={selectedShot.startFrameAssetId}
                    bindLabel="设为首帧"
                    clearLabel="清除首帧"
                    disabled={isBusy}
                    emptyText="首帧未绑定"
                    label="首帧"
                    onBind={() => bindSelectedShotFrameAsset("startFrameAssetId")}
                    onClear={() => setSelectedShotFrameAsset("startFrameAssetId", null)}
                    onFocus={onFocusAssetOnBoard}
                    onPreview={onPreviewAsset}
                  />
                  <FrameBindingControl
                    asset={selectedShot.endFrameAssetId ? assetById.get(selectedShot.endFrameAssetId) ?? null : null}
                    assetId={selectedShot.endFrameAssetId}
                    bindLabel="设为尾帧"
                    clearLabel="清除尾帧"
                    disabled={isBusy}
                    emptyText="尾帧未绑定"
                    label="尾帧"
                    onBind={() => bindSelectedShotFrameAsset("endFrameAssetId")}
                    onClear={() => setSelectedShotFrameAsset("endFrameAssetId", null)}
                    onFocus={onFocusAssetOnBoard}
                    onPreview={onPreviewAsset}
                  />
                </div>
                <div className="storyboard-frame-generation-placeholder" aria-label="首尾帧生成">
                  <div>
                    <span className="storyboard-phase-badge">图片生成</span>
                    <strong>首尾帧生成</strong>
                    <span>使用首帧/尾帧提示词创建图片任务，并自动绑定生成素材。</span>
                  </div>
                  <div>
                    <button
                      disabled={isBusy || !selectedShot.startFramePrompt.trim()}
                      onClick={() => generateShotFrame("start")}
                      title={!selectedShot.startFramePrompt.trim() ? "请先生成或填写首帧提示词" : "生成并绑定首帧图片"}
                      type="button"
                    >
                      生成首帧
                    </button>
                    <button
                      disabled={isBusy || !selectedShot.endFramePrompt.trim()}
                      onClick={() => generateShotFrame("end")}
                      title={!selectedShot.endFramePrompt.trim() ? "请先生成或填写尾帧提示词" : "生成并绑定尾帧图片"}
                      type="button"
                    >
                      生成尾帧
                    </button>
                  </div>
                </div>
              </div>
              <PromptTextarea
                field="startFramePrompt"
                isLocked={getPromptLocks(selectedShot).startFramePrompt}
                label="首帧提示词"
                onLockChange={patchSelectedPromptLock}
                onCopy={copyPromptText}
                onValueChange={(value) => patchSelectedShotDraft({ startFramePrompt: value })}
                value={selectedShot.startFramePrompt}
              />
              <PromptTextarea
                field="endFramePrompt"
                isLocked={getPromptLocks(selectedShot).endFramePrompt}
                label="尾帧提示词"
                onLockChange={patchSelectedPromptLock}
                onCopy={copyPromptText}
                onValueChange={(value) => patchSelectedShotDraft({ endFramePrompt: value })}
                value={selectedShot.endFramePrompt}
              />
              <PromptTextarea
                field="videoPrompt"
                isLocked={getPromptLocks(selectedShot).videoPrompt}
                label="视频提示词"
                onLockChange={patchSelectedPromptLock}
                onCopy={copyPromptText}
                onValueChange={(value) => patchSelectedShotDraft({ videoPrompt: value })}
                value={selectedShot.videoPrompt}
              />
            </>
          ) : (
            <p className="muted">输入文案后生成结构化分镜，或手动新增镜头。</p>
          )}
        </section>
      </div>
    </section>
  );
}

function normalizeBriefDraft(brief: Partial<StoryboardBriefPayload>) {
  return {
    aspectRatio: brief.aspectRatio ?? "",
    audience: brief.audience ?? "",
    constraints: brief.constraints ?? "",
    contentType: brief.contentType ?? "product",
    durationSec: brief.durationSec ?? 30,
    locale: brief.locale ?? "",
    sellingPoints: brief.sellingPoints ?? "",
    targetPlatform: brief.targetPlatform ?? "douyin",
    tone: brief.tone ?? "",
    topic: brief.topic ?? "",
  };
}

function hasBriefDraftContent(brief: Partial<StoryboardBriefPayload>) {
  const normalized = normalizeBriefDraft(brief);
  return Boolean(
    normalized.aspectRatio ||
      normalized.audience ||
      normalized.constraints ||
      normalized.locale ||
      normalized.sellingPoints ||
      normalized.tone ||
      normalized.topic,
  );
}

function areShotsEqual(first: StoryboardShotPayload, second: StoryboardShotPayload) {
  return JSON.stringify(normalizeShotForCompare(first)) === JSON.stringify(normalizeShotForCompare(second));
}

function normalizeShotForCompare(shot: StoryboardShotPayload) {
  return {
    action: shot.action,
    audio: shot.audio,
    camera: shot.camera,
    caption: shot.caption,
    dialogue: shot.dialogue,
    durationSec: shot.durationSec,
    endFrameAssetId: shot.endFrameAssetId,
    endFramePrompt: shot.endFramePrompt,
    metadata: shot.metadata,
    scene: shot.scene,
    startFrameAssetId: shot.startFrameAssetId,
    startFramePrompt: shot.startFramePrompt,
    status: shot.status,
    videoPrompt: shot.videoPrompt,
  };
}

function getShotStats(shots: StoryboardShotPayload[]) {
  return {
    byStatus: shots.reduce<Record<string, number>>((counts, shot) => {
      counts[shot.status] = (counts[shot.status] ?? 0) + 1;
      return counts;
    }, {}),
    missingPrompts: shots.filter((shot) => getMissingPromptCount(shot) > 0).length,
  };
}

function getFilteredShots(shots: StoryboardShotPayload[], filter: ShotFilter) {
  if (filter === "all") return shots;
  if (filter === "missing_prompts") return shots.filter((shot) => getMissingPromptCount(shot) > 0);
  return shots.filter((shot) => shot.status === filter);
}

function getMissingPromptCount(shot: StoryboardShotPayload) {
  return [shot.startFramePrompt, shot.endFramePrompt, shot.videoPrompt].filter((value) => !value.trim()).length;
}

function buildShotPromptPackage(shot: StoryboardShotPayload, assetById: Map<string, AssetPayload>) {
  return [
    `# 镜头 ${shot.shotIndex}: ${shot.caption || shot.action || "未命名镜头"}`,
    "",
    `- 状态: ${getStoryboardStatusLabel(shot.status)}`,
    `- 时长: ${shot.durationSec}s`,
    `- 场景: ${shot.scene || "未填写"}`,
    `- 机位: ${shot.camera || "未填写"}`,
    `- 动作: ${shot.action || "未填写"}`,
    `- 台词: ${shot.dialogue || "未填写"}`,
    `- 字幕: ${shot.caption || "未填写"}`,
    `- 音频: ${shot.audio || "未填写"}`,
    `- 首帧素材: ${formatPromptPackageAsset(shot.startFrameAssetId, assetById)}`,
    `- 尾帧素材: ${formatPromptPackageAsset(shot.endFrameAssetId, assetById)}`,
    "",
    "## 首帧提示词",
    "",
    shot.startFramePrompt || "未生成",
    "",
    "## 尾帧提示词",
    "",
    shot.endFramePrompt || "未生成",
    "",
    "## 视频提示词",
    "",
    shot.videoPrompt || "未生成",
  ].join("\n");
}

function formatPromptPackageAsset(assetId: string | null, assetById: Map<string, AssetPayload>) {
  if (!assetId) return "未绑定";
  const asset = assetById.get(assetId);
  if (!asset) return `${assetId} (素材记录缺失)`;
  const parts = [asset.id, getAssetKindLabel(asset.kind), formatAssetSize(asset), asset.publicUrl].filter(Boolean);
  const tags = getAssetTags(asset);
  if (tags.length > 0) parts.push(`tags=${tags.join("/")}`);
  return parts.join(" | ");
}

function getAssetTags(asset: AssetPayload) {
  return Array.isArray(asset.tags) ? asset.tags.filter((tag) => typeof tag === "string" && tag.trim().length > 0) : [];
}

function FrameBindingControl({
  asset,
  assetId,
  bindLabel,
  clearLabel,
  disabled,
  emptyText,
  label,
  onBind,
  onClear,
  onFocus,
  onPreview,
}: {
  asset: AssetPayload | null;
  assetId: string | null;
  bindLabel: string;
  clearLabel: string;
  disabled: boolean;
  emptyText: string;
  label: string;
  onBind: () => void;
  onClear: () => void;
  onFocus?: (assetId: string) => void;
  onPreview?: (asset: AssetPayload) => void;
}) {
  return (
    <div className={["storyboard-frame-binding-control", assetId && !asset ? "is-missing" : ""].filter(Boolean).join(" ")}>
      {asset ? (
        <button
          aria-label={`预览${label}素材`}
          className="storyboard-frame-binding-preview"
          disabled={!onPreview}
          onClick={() => onPreview?.(asset)}
          type="button"
        >
          <img alt="" src={apiUrl(asset.publicUrl)} />
        </button>
      ) : (
        <div className="storyboard-frame-binding-preview" aria-hidden="true">
          <span>{assetId ? "失效" : label}</span>
        </div>
      )}
      <span>{label}</span>
      <em>{getFrameBindingStatusText(assetId, asset, emptyText)}</em>
      <div>
        <button disabled={disabled} onClick={onBind} type="button">{bindLabel}</button>
        <button disabled={disabled || !assetId || !onFocus} onClick={() => assetId ? onFocus?.(assetId) : undefined} type="button">定位</button>
        <button disabled={disabled || !asset || !onPreview} onClick={() => asset ? onPreview?.(asset) : undefined} type="button">查看</button>
        <button disabled={disabled || !assetId} onClick={onClear} type="button">{clearLabel}</button>
      </div>
    </div>
  );
}

function getFrameBindingStatusText(assetId: string | null, asset: AssetPayload | null, emptyText: string) {
  if (!assetId) return emptyText;
  if (!asset) return "素材已失效";
  return `${getAssetKindLabel(asset.kind)} ${formatAssetSize(asset)}`;
}

function getAssetKindLabel(kind: string) {
  const labels: Record<string, string> = {
    generated: "生成图",
    mask: "蒙版",
    source: "源图",
    upload: "上传图",
  };
  return labels[kind] ?? kind;
}

function formatAssetSize(asset: Pick<AssetPayload, "height" | "width">) {
  return asset.width && asset.height ? `${asset.width}x${asset.height}` : "未记录尺寸";
}

function PromptTextarea({
  field,
  isLocked,
  label,
  onCopy,
  onLockChange,
  onValueChange,
  value,
}: {
  field: PromptField;
  isLocked: boolean;
  label: string;
  onCopy: (label: string, value: string) => void;
  onLockChange: (field: PromptField, locked: boolean) => void;
  onValueChange: (value: string) => void;
  value: string;
}) {
  return (
    <label>
      <span className="storyboard-prompt-label-row">
        <span>{label}</span>
        <span className="storyboard-prompt-tools">
          <button disabled={!value.trim()} onClick={() => onCopy(label, value)} type="button">复制</button>
          <span className="storyboard-prompt-lock">
            <input
              checked={isLocked}
              onChange={(event) => onLockChange(field, event.target.checked)}
              type="checkbox"
            />
            锁定
          </span>
        </span>
      </span>
      <textarea value={value} onChange={(event) => onValueChange(event.target.value)} />
    </label>
  );
}

function getPromptLocks(shot: StoryboardShotPayload) {
  const rawLocks = shot.metadata.promptLocks;
  const locks = rawLocks && typeof rawLocks === "object" && !Array.isArray(rawLocks)
    ? rawLocks as Record<string, unknown>
    : {};
  return {
    startFramePrompt: locks.startFramePrompt === true,
    endFramePrompt: locks.endFramePrompt === true,
    videoPrompt: locks.videoPrompt === true,
  };
}
