export function shouldUseAgbStatsResultForSelection(
  activeSelectionUid: string | null,
  currentSelectionUid: string | null,
): boolean {
  if (!activeSelectionUid || !currentSelectionUid) {
    return false;
  }

  return activeSelectionUid === currentSelectionUid;
}

export function shouldUseStatsResultForSelection(
  activeSelectionUid: string | null,
  currentSelectionUid: string | null,
): boolean {
  if (!currentSelectionUid) {
    return false;
  }

  if (!activeSelectionUid) {
    return false;
  }

  return activeSelectionUid === currentSelectionUid;
}
