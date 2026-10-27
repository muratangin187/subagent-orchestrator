export const initialLayout = { left: "assistant", right: null, voice: false };
export function updateLayout(layout, action) {
  if (action.type === "select") return { ...layout, [action.pane]: action.id };
  if (action.type === "split")
    return action.id === "assistant"
      ? layout
      : { ...layout, left: "assistant", right: action.id };
  if (action.type === "close") return { ...layout, right: null };
  if (action.type === "voice")
    return { ...layout, left: "assistant", voice: action.open };
  return layout;
}
export function splitRatio(value, width, minimum = 340) {
  const edge = Math.min(0.5, minimum / Math.max(1, width));
  return Math.max(
    edge,
    Math.min(1 - edge, Number.isFinite(value) ? value : 0.5),
  );
}
