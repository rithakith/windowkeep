// SPDX-License-Identifier: GPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import {destination, normalized, matchScore, validateProfile} from '../model.js';

test('relative geometry survives negative origins and resolution changes', () => {
    const relative = normalized({x: -1800, y: 40, width: 900, height: 1000}, {x: -1920, y: 0, width: 1920, height: 1080});
    const r = destination({absolute: {}, relative}, 'changed', {x: -1280, y: 0, width: 1280, height: 720});
    assert.deepEqual(r, {x: -1200, y: 27, width: 600, height: 667});
});
test('oversized and offscreen absolute geometry is clamped', () => {
    assert.deepEqual(destination({absolute: {same: {x: -9000, y: 9000, width: 4000, height: 4000}}}, 'same', {x: -1280, y: 24, width: 1280, height: 696}), {x: -1280, y: 24, width: 1280, height: 696});
});
test('stable sequence only helps matching inside the same login', () => {
    const saved = {appId: 'a.desktop', title: 'a', wmClassInstance: 'a', stableSequence: 5, transient: false};
    assert.equal(matchScore(saved, {...saved, appId: 'b.desktop'}, true), -1);
    assert.equal(matchScore(saved, saved, true) - matchScore(saved, saved, false), 1000);
    assert.equal(matchScore(saved, {...saved, transient: true}, true), -1);
});
test('untrusted schema and paths are rejected', () => {
    assert.throws(() => validateProfile({schemaVersion: 900}));
    assert.throws(() => validateProfile({schemaVersion: 1, provider: 'shell-heuristic-v1', id: '../x', name: 'x'}));
});
