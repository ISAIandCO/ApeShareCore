import test from 'node:test';
import assert from 'node:assert/strict';
import { detectEventPlatform, filterSupportsPlatform } from '../src/filters/platform.js';

test('explicit source OS wins over product and paths', () => {
  assert.equal(detectEventPlatform({ os: ['Linux'], source: ['Microsoft Windows'], paths: ['C:\\file'] }), 'unix');
  assert.equal(detectEventPlatform({ source: ['Microsoft-Windows-Security-Auditing'] }), 'windows');
  assert.equal(detectEventPlatform({ source: ['auditd'] }), 'unix');
  assert.equal(detectEventPlatform({ paths: ['/usr/bin/bash'] }), 'unix');
  assert.equal(detectEventPlatform({ paths: ['HKEY_LOCAL_MACHINE\\Software'] }), 'windows');
});

test('ambiguous evidence does not enable platform-specific filters', () => {
  for (const evidence of [{}, { os: ['Windows', 'Linux'] }, { paths: ['/bin/sh', 'C:\\cmd.exe'] }]) {
    const platform = detectEventPlatform(evidence);
    assert.equal(platform, 'unknown');
    assert.equal(filterSupportsPlatform({ platforms: ['windows'] }, platform), false);
    assert.equal(filterSupportsPlatform({}, platform), true);
  }
  assert.equal(filterSupportsPlatform({ platforms: ['windows'] }, 'windows'), true);
  assert.equal(filterSupportsPlatform({ platforms: ['windows'] }, 'unix'), false);
});
