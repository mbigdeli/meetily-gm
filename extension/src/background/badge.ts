export async function setBadgeRecording(active: boolean, tabId?: number): Promise<void> {
  const tabOpts = tabId !== undefined ? { tabId } : {};
  await chrome.action.setBadgeText({ text: active ? "REC" : "", ...tabOpts });
  if (active) {
    await chrome.action.setBadgeBackgroundColor({ color: "#dc362e", ...tabOpts });
  }
  await chrome.action.setTitle({
    title: active
      ? "Meeting Capture — recording"
      : "Meeting Capture",
    ...tabOpts,
  });
}
