/**
 * Studio Expressions and Hotkey Binding Logic
 */

export function shouldIgnoreHotkey(targetTagName: string | undefined | null): boolean {
  if (!targetTagName) return false;
  const upper = targetTagName.toUpperCase();
  return upper === "INPUT" || upper === "TEXTAREA" || upper === "SELECT";
}

export function resolveHotkeyIndex(
  key: string,
  availableExpressions: string[]
): string | null {
  const keyNum = parseInt(key, 10);
  if (!isNaN(keyNum) && keyNum >= 1 && keyNum <= 9) {
    const idx = keyNum - 1;
    if (availableExpressions && availableExpressions[idx]) {
      return availableExpressions[idx];
    }
  }
  return null;
}

export function toggleLocalExpression(
  currentActive: Record<string, boolean>,
  name: string
): Record<string, boolean> {
  const next = { ...currentActive };
  const currentVal = Boolean(next[name]);
  next[name] = !currentVal;
  return next;
}
