import assert from "node:assert/strict";
import test from "node:test";

import { buildReleaseGuide } from "../scripts/release-guide.mjs";

test("buildReleaseGuide includes publish commands and excludes secrets", () => {
  const guide = buildReleaseGuide({
    repo: "LittleXingzzZ/pulsegraph-xlayer",
    branch: "main"
  });

  assert.match(guide, /gh auth login -h github\.com/);
  assert.match(guide, /git add README\.md deployment\/xlayer-mainnet\.pending\.json docs scripts tests web package\.json/);
  assert.match(guide, /git commit -m "Add final demo and submission materials"/);
  assert.match(guide, /gh repo create LittleXingzzZ\/pulsegraph-xlayer/);
  assert.match(guide, /git push -u origin main/);
  assert.match(guide, /GitHub Pages/);
  assert.doesNotMatch(guide, /PRIVATE_KEY/);
  assert.doesNotMatch(guide, /\.env\b/);
});
