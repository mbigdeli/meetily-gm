import test from 'node:test';
import assert from 'node:assert/strict';
import { hasRenderableSummary } from '../../src/lib/summary-content-state.mjs';

test('accepts generated markdown wrapped with an English cache', () => {
  assert.equal(hasRenderableSummary({
    english_cache: { markdown: '# Cached title' },
    markdown: '**Summary**\n\nVisible content',
  }), true);
});

test('rejects empty or metadata-only summary objects', () => {
  assert.equal(hasRenderableSummary({}), false);
  assert.equal(hasRenderableSummary({ markdown: '  ', english_cache: {} }), false);
});

test('accepts BlockNote and legacy summary content', () => {
  assert.equal(hasRenderableSummary({ summary_json: [{ type: 'paragraph' }] }), true);
  assert.equal(hasRenderableSummary({
    decisions: { title: 'Decisions', blocks: [{ content: 'Ship it' }] },
  }), true);
});
