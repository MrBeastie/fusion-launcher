import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { previewApi } from './previewData.ts';

describe('preview one-click setup support', () => {
  it('installs the NES emulator through the orchestrator preview path', async () => {
    await previewApi.deleteEmulatorConfig('nes');

    const before = await previewApi.getEmulatorStatus('nes');
    assert.equal(before.installed, false);

    const result = await previewApi.installEmulator('nes');
    const after = await previewApi.getEmulatorStatus('nes');

    assert.equal(result.profileId, 'nes-mesen');
    assert.equal(after.installed, true);
    assert.equal(after.exePath, result.exePath);
  });

  it('can prepare the preview demo download for launch', async () => {
    await previewApi.installEmulator('nes');

    const report = await previewApi.startGameDownload('retrohydra_nes_smoke');
    const launch = await previewApi.launchGame('retrohydra_nes_smoke');

    assert.equal(report.sourceKind, 'bundled');
    assert.equal(report.torrent?.status, 'completed');
    assert.equal(launch.executable, 'preview://emulators/nes/Mesen.exe');
  });

  it('runs the full zero-friction install flow', async () => {
    await previewApi.deleteEmulatorConfig('nes');
    await previewApi.removeGame('retrohydra_nes_smoke', true);

    const result = await previewApi.installGame('retrohydra_nes_smoke');
    const emulator = await previewApi.getEmulatorStatus('nes');
    const setup = await previewApi.getGameSetupState('retrohydra_nes_smoke');

    assert.equal(result.status, 'ready');
    assert.equal(emulator.installed, true);
    assert.equal(setup.launch.status, 'ready');
  });

  it('keeps Switch emulator selection manual', async () => {
    await previewApi.deleteEmulatorConfig('switch');

    const result = await previewApi.installGame('star-orbit');

    assert.equal(result.status, 'error');
    assert.equal(result.errorCode, 'switch_emulator_not_configured');
  });
});
