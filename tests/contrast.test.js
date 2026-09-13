import test from 'node:test';
import assert from 'node:assert/strict';

// WCAG 2.1 contrast checks for the Tailwind color pairs actually used in src/App.jsx
// for text and icon-only controls on light backgrounds. Dark-background pairs (e.g.
// text-slate-400 on bg-slate-900) are intentionally not covered here since Tailwind's
// default palette makes light-gray-on-white the far more common failure mode; add a
// case below whenever a new color pairing is introduced on a light background.
const palette = {
  white: '#ffffff',
  'slate-50': '#f8fafc', 'slate-100': '#f1f5f9', 'slate-200': '#e2e8f0',
  'slate-500': '#64748b', 'slate-600': '#475569',
  'blue-50': '#eff6ff',
  'emerald-50': '#ecfdf5', 'emerald-100': '#d1fae5', 'emerald-700': '#047857',
  'amber-50': '#fffbeb',
  'violet-50': '#f5f3ff', 'violet-100': '#ede9fe', 'violet-600': '#7c3aed',
  'red-600': '#dc2626', 'red-700': '#b91c1c',
  'orange-100': '#ffedd5', 'orange-800': '#9a3412',
  'rose-100': '#ffe4e6', 'rose-700': '#be123c',
  'yellow-100': '#fef9c3', 'yellow-800': '#854d0e',
};

function srgbToLinear(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function relativeLuminance(hex) {
  const n = hex.replace('#', '');
  const r = parseInt(n.slice(0, 2), 16), g = parseInt(n.slice(2, 4), 16), b = parseInt(n.slice(4, 6), 16);
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}
function contrastRatio(fgKey, bgKey) {
  const fg = relativeLuminance(palette[fgKey]), bg = relativeLuminance(palette[bgKey]);
  const [lighter, darker] = fg > bg ? [fg, bg] : [bg, fg];
  return (lighter + 0.05) / (darker + 0.05);
}

// [description, foreground, background, minimum ratio]. 4.5 = WCAG AA for normal text;
// 3 = WCAG AA for large text and for non-text UI components (icon-only controls).
const normalTextPairs = [
  ['muted labels/meta text (slate-600 on white)', 'slate-600', 'white', 4.5],
  ['muted labels on slate-50 cards', 'slate-600', 'slate-50', 4.5],
  ['muted labels on violet-50 cards', 'slate-600', 'violet-50', 4.5],
  ['Active Daily Demand label', 'violet-600', 'violet-50', 4.5],
  ['New Appliance/Edit Device header', 'violet-600', 'violet-100', 4.5],
  ['Delete text buttons', 'red-600', 'white', 4.5],
  ['Delete selected (on blue-50 banner)', 'red-700', 'blue-50', 4.5],
  ['Estimated Cost label', 'emerald-700', 'emerald-50', 4.5],
  ['Exp toggle active state', 'orange-800', 'orange-100', 4.5],
  ['Cal toggle active state', 'emerald-700', 'emerald-100', 4.5],
  ['macro tag Carbs', 'orange-800', 'orange-100', 4.5],
  ['macro tag Protein', 'rose-700', 'rose-100', 4.5],
  ['macro tag Fat', 'yellow-800', 'yellow-100', 4.5],
  ['macro tag Balanced', 'emerald-700', 'emerald-100', 4.5],
];

const iconOnlyPairs = [
  ['off-state power toggle icon', 'slate-500', 'slate-200', 3],
  ['appliance edit chevron button', 'slate-500', 'white', 3],
  ['inactive sort-by-expiry icon', 'slate-500', 'slate-100', 3],
  ['buy/move-to-inventory icon', 'slate-500', 'slate-100', 3],
  ['AI modal close icon', 'slate-500', 'slate-100', 3],
];

test('text on light backgrounds meets WCAG AA (4.5:1) for the audited pairs', () => {
  for (const [label, fg, bg, min] of normalTextPairs) {
    const ratio = contrastRatio(fg, bg);
    assert.ok(ratio >= min, `${label}: ${fg} on ${bg} is ${ratio.toFixed(2)}:1, needs >= ${min}:1`);
  }
});

test('icon-only controls meet WCAG AA non-text contrast (3:1) for the audited pairs', () => {
  for (const [label, fg, bg, min] of iconOnlyPairs) {
    const ratio = contrastRatio(fg, bg);
    assert.ok(ratio >= min, `${label}: ${fg} on ${bg} is ${ratio.toFixed(2)}:1, needs >= ${min}:1`);
  }
});
