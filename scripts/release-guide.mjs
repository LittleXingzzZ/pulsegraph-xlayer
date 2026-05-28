import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function buildReleaseGuide({
  repo = "LittleXingzzZ/pulsegraph-xlayer",
  branch = "main"
} = {}) {
  return `# PulseGraph Final Release Guide

## 1. Save Local Release Changes

Make sure the non-secret release artifacts are committed before publishing.

\`\`\`bash
git status --short
git add README.md deployment/xlayer-mainnet.pending.json docs scripts tests web package.json
git commit -m "Add final demo and submission materials"
git status --short
\`\`\`

## 2. Publish GitHub Repository

\`\`\`bash
gh auth login -h github.com
gh repo create ${repo} --public --source . --remote origin --push
git push -u origin ${branch}
\`\`\`

If the repository already exists:

\`\`\`bash
git remote add origin git@github.com:${repo}.git
git push -u origin ${branch}
\`\`\`

Public repository URL:

\`\`\`text
https://github.com/${repo}
\`\`\`

## 3. Publish Demo

Use GitHub Pages with the static files in \`web/\`. The interactive demo is \`index.html\`;
the recording-ready video storyboard is \`video.html\`.

Recommended quick path:

\`\`\`bash
git subtree push --prefix web origin gh-pages
\`\`\`

Then enable GitHub Pages for branch \`gh-pages\` in repository settings.

Expected Demo URL:

\`\`\`text
https://${repo.split("/")[0]}.github.io/${repo.split("/")[1]}/
\`\`\`

Expected video storyboard URL:

\`\`\`text
https://${repo.split("/")[0]}.github.io/${repo.split("/")[1]}/video.html
\`\`\`

## 4. Verify Source

Open:

\`\`\`text
https://www.oklink.com/x-layer/verify-contract-preliminary
\`\`\`

Use:

\`\`\`text
Contract: 0x0f307dc905592fbef047b8dddcc50f9415b286c0
Contract name: PulseHookV4
Compiler: v0.8.35+commit.47b9dedd
Code format: Solidity standard JSON input
Optimization: enabled
Runs: 20000
Constructor args file: verification/PulseHookV4.constructor-args.txt
Standard JSON file: verification/PulseHookV4.oklink-standard-json.json
\`\`\`

## 5. Final X Post

Use the final post draft in \`docs/x-posts.md\`, then fill:

\`\`\`bash
npm run manifest:update -- \\
  --verified-source-url https://www.oklink.com/x-layer/address/0x0f307dc905592fbef047b8dddcc50f9415b286c0/contract \\
  --demo-url https://${repo.split("/")[0]}.github.io/${repo.split("/")[1]}/ \\
  --demo-video-url https://YOUR_VIDEO_URL \\
  --x-account https://x.com/YOUR_PROJECT_ACCOUNT \\
  --final-x-post-url https://x.com/YOUR_PROJECT_ACCOUNT/status/...
\`\`\`

## 6. Final Gate

\`\`\`bash
GITHUB_URL=https://github.com/${repo} npm run readiness:audit
npm run submission:packet
\`\`\`
`;
}

async function main() {
  const guide = buildReleaseGuide();
  writeFileSync("docs/final-release-guide.md", guide);
  console.log("Wrote docs/final-release-guide.md");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
