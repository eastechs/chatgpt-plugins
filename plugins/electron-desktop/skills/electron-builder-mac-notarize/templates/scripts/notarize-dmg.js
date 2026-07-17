const { execFileSync } = require('node:child_process');
const path = require('node:path');

module.exports = async function notarizeDmg(buildResult) {
  const dmgs = (buildResult.artifactPaths || []).filter((p) => p.endsWith('.dmg'));
  if (dmgs.length === 0) {
    return [];
  }

  if (process.platform !== 'darwin') {
    throw new Error('[notarize-dmg] DMG artifacts present but not running on macOS — cannot run xcrun');
  }

  const { APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID } = process.env;
  const missing = ['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID'].filter(
    (k) => !process.env[k],
  );
  if (missing.length > 0) {
    throw new Error(`[notarize-dmg] missing env vars: ${missing.join(', ')}`);
  }

  for (const dmg of dmgs) {
    const name = path.basename(dmg);
    console.log(`[notarize-dmg] submitting ${name} to notary service...`);
    execFileSync(
      'xcrun',
      [
        'notarytool',
        'submit',
        dmg,
        '--apple-id',
        APPLE_ID,
        '--team-id',
        APPLE_TEAM_ID,
        '--password',
        APPLE_APP_SPECIFIC_PASSWORD,
        '--wait',
      ],
      { stdio: 'inherit' },
    );
    console.log(`[notarize-dmg] stapling ${name}...`);
    execFileSync('xcrun', ['stapler', 'staple', dmg], { stdio: 'inherit' });
    console.log(`[notarize-dmg] validating ${name}...`);
    execFileSync('xcrun', ['stapler', 'validate', dmg], { stdio: 'inherit' });
  }

  return [];
};
