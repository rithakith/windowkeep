// SPDX-License-Identifier: GPL-3.0-or-later
export const SCHEMA_VERSION = 1;
export const MAX_BYTES = 4 * 1024 * 1024;
export function validId(id) {
    return typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}
function requireValue(test, message) {
    if (!test)
        throw new Error(message);
}
function text(value, max = 8192) {
    return typeof value === 'string' && value.length <= max && !value.includes('\0');
}
function index(value, max = 255) {
    return Number.isInteger(value) && value >= 0 && value <= max;
}
function rect(r, relative = false) {
    return r && ['x', 'y', 'width', 'height'].every(k => Number.isFinite(r[k]) && Math.abs(r[k]) < (relative ? 100 : 1000000)) && r.width > 0 && r.height > 0;
}
export function validateProfile(p) {
    requireValue(p && p.schemaVersion === SCHEMA_VERSION && p.provider === 'shell-heuristic-v1', 'Unsupported profile schema or provider');
    requireValue(validId(p.id) && text(p.name, 200) && p.name.trim().length > 0, 'Invalid profile identity');
    requireValue(text(p.createdAt, 100) && text(p.layout, 32768) && text(p.login, 200), 'Invalid profile metadata');
    requireValue(index(p.workspaceCount, 64) && p.workspaceCount > 0 && index(p.activeWorkspace, 63), 'Invalid workspace count');
    requireValue(Array.isArray(p.monitors) && p.monitors.length > 0 && p.monitors.length <= 32, 'Invalid monitors');
    for (const m of p.monitors)
        requireValue(index(m.index, 31) && text(m.connector, 200) && rect(m.geometry) && rect(m.workArea) && Number.isFinite(m.scale) && m.scale > 0, 'Invalid monitor');
    requireValue(Array.isArray(p.windows) && p.windows.length <= 1000, 'Invalid windows');
    const ids = new Set();
    for (const w of p.windows) {
        requireValue(validId(w.id) && !ids.has(w.id), 'Invalid or duplicate window ID');
        ids.add(w.id);
        requireValue(['appId', 'wmClass', 'wmClassInstance', 'title'].every(k => text(w[k])), 'Invalid window identity');
        requireValue(index(w.type, 30) && index(w.workspace, 63) && index(w.monitor, 31) && index(w.stacking, 1000), 'Invalid window destination');
        requireValue(index(w.stableSequence, Number.MAX_SAFE_INTEGER) && index(w.pid, Number.MAX_SAFE_INTEGER), 'Invalid window token');
        requireValue(index(w.maximized, 3) && ['normal', 'left', 'right'].includes(w.tile), 'Invalid window state');
        requireValue(['above', 'sticky', 'skipTaskbar', 'fullscreen', 'minimized', 'transient'].every(k => typeof w[k] === 'boolean'), 'Invalid state flags');
        requireValue(rect(w.relative, true) && w.absolute && rect(w.absolute[p.layout]), 'Invalid window geometry');
        requireValue(w.command === null || (Array.isArray(w.command) && w.command.length > 0 && w.command.length <= 256 && w.command.every(a => text(a))), 'Invalid command');
    }
    return p;
}
export function signature(monitors) {
    return JSON.stringify(monitors.map(m => [m.connector, m.geometry, m.scale]));
}
export function normalized(r, area) {
    return {x: (r.x - area.x) / area.width, y: (r.y - area.y) / area.height, width: r.width / area.width, height: r.height / area.height};
}
export function destination(w, layout, area) {
    const r = w.absolute[layout] ?? {
        x: area.x + w.relative.x * area.width,
        y: area.y + w.relative.y * area.height,
        width: w.relative.width * area.width,
        height: w.relative.height * area.height,
    };
    const width = Math.max(1, Math.min(Math.round(r.width), area.width));
    const height = Math.max(1, Math.min(Math.round(r.height), area.height));
    return {x: Math.round(Math.max(area.x, Math.min(r.x, area.x + area.width - width))), y: Math.round(Math.max(area.y, Math.min(r.y, area.y + area.height - height))), width, height};
}
export function identityMatches(saved, current) {
    if (saved.appId && current.appId)
        return saved.appId === current.appId;
    return Boolean(saved.wmClass && saved.wmClass === current.wmClass && (!saved.wmClassInstance || saved.wmClassInstance === current.wmClassInstance));
}
export function matchScore(saved, current, sameLogin) {
    if (!identityMatches(saved, current) || saved.transient !== current.transient || (current.type !== undefined && saved.type !== current.type))
        return -1;
    return (sameLogin && saved.stableSequence === current.stableSequence ? 1000 : 0) +
        (saved.title === current.title ? 100 : 0) +
        (saved.wmClassInstance === current.wmClassInstance ? 10 : 0);
}
