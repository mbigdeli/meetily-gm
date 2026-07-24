const META_KEYS = new Set([
  'MeetingName',
  '_section_order',
  'english_cache',
  'markdown',
  'summary_json',
]);

export function hasRenderableSummary(summary) {
  if (!summary || typeof summary !== 'object') return false;

  if (typeof summary.markdown === 'string' && summary.markdown.trim()) {
    return true;
  }

  if (Array.isArray(summary.summary_json) && summary.summary_json.length > 0) {
    return true;
  }

  return Object.entries(summary).some(([key, section]) => {
    if (META_KEYS.has(key) || !section || typeof section !== 'object') {
      return false;
    }
    return Array.isArray(section.blocks) && section.blocks.length > 0;
  });
}
