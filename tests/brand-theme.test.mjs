import { test } from "node:test";
import assert from "node:assert/strict";
import postcss from "postcss";
import { brandTheme } from "../scripts/build/brand-theme.mjs";
test("brand theme preserves selectors, alpha, direct fallback and unrelated colors", async () => {
  const css =
    ".bg-\\[\\#C7FF00\\]{background:#C7FF00;border-color:#c7ff0033;color:#fff;--brand-accent:#abcdef}";
  const result = await postcss([brandTheme()]).process(css, {
    from: undefined,
  });
  assert.match(result.css, /\.bg-\\\[\\#C7FF00/);
  assert.match(result.css, /background:var\(--brand-accent, #C7FF00\)/);
  assert.match(result.css, /199 255 0\) \/ 0.2/);
  assert.match(result.css, /color:#fff/);
  assert.match(result.css, /--brand-accent:#abcdef/);
  const repeated = await postcss([brandTheme()]).process(result.css, {
    from: undefined,
  });
  assert.equal(repeated.css, result.css);
});
