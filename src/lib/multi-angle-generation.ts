export const multiAngleOptions = [
  {
    value: "angle_set",
    label: "多个角度",
    instruction: "a set of distinct camera viewpoints including left 45-degree, right 45-degree, side-view, rear-view, overhead, and low-angle perspectives",
  },
  {
    value: "left_45",
    label: "左 45 度",
    instruction: "a left 45-degree camera angle",
  },
  {
    value: "right_45",
    label: "右 45 度",
    instruction: "a right 45-degree camera angle",
  },
  {
    value: "side",
    label: "侧面",
    instruction: "a side-view camera angle",
  },
  {
    value: "back",
    label: "背面",
    instruction: "a rear-view camera angle showing the back side",
  },
  {
    value: "overhead",
    label: "俯视",
    instruction: "an overhead camera angle",
  },
  {
    value: "low_angle",
    label: "仰视",
    instruction: "a low-angle camera viewpoint",
  },
] as const;

export type MultiAngleOptionValue = (typeof multiAngleOptions)[number]["value"];

export const defaultMultiAngleOptionValue: MultiAngleOptionValue = "angle_set";

export function buildMultiAnglePrompt(input: {
  angle: MultiAngleOptionValue;
  candidateCount?: number;
  userInstruction?: string;
}) {
  const option =
    multiAngleOptions.find((item) => item.value === input.angle) ??
    multiAngleOptions.find((item) => item.value === defaultMultiAngleOptionValue) ??
    multiAngleOptions[0];
  const candidateCount = Math.max(1, Math.floor(input.candidateCount ?? 1));
  const userInstruction = input.userInstruction?.trim();
  const isDefaultAngleSet = input.angle === defaultMultiAngleOptionValue;
  const angleInstruction =
    isDefaultAngleSet && candidateCount === 1
      ? "a different camera viewpoint selected from left 45-degree, right 45-degree, side-view, rear-view, overhead, and low-angle perspectives"
      : option.instruction;

  return [
    `Generate the same scene from ${angleInstruction}.`,
    candidateCount > 1 && isDefaultAngleSet
      ? "Each generated candidate must use a different viewpoint from the requested viewpoint set."
      : "",
    "Keep the same person identity, face, age, body type, clothing, hairstyle, accessories, and expression continuity.",
    "Keep the same environment, location, objects, lighting mood, time of day, color palette, and visual style.",
    "Only change the camera viewpoint, perspective, framing, and visible side of the subject/environment.",
    "Do not redesign the character, outfit, background, props, or scene. Do not create a new person or new location.",
    userInstruction ? `Additional user instruction: ${userInstruction}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
