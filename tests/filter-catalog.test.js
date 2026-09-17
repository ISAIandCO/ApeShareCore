import test from "node:test";
import assert from "node:assert/strict";
import { composeFilterCatalog, splitLegacyFilters, importFilterCatalog, exportFilterCatalog, normalizeUserFilters } from "../src/filters/catalog.js";

const builtins = [{ id: "host", name: "Host", template: "Host = '${Host}'", enabled: true }];
test("migration preserves edits and disabled flags without freezing shipped definitions", () => {
  assert.deepEqual(splitLegacyFilters(builtins, builtins), { userFilters: [], disabledBuiltinFilterIds: [] });
  const edited = { ...builtins[0], template: "Host = 'fixed'" };
  const migrated = splitLegacyFilters([edited], builtins);
  assert.deepEqual(migrated.userFilters, [edited]);
  const result = composeFilterCatalog([{ ...builtins[0], template: "NewHost = '${Host}'" }], migrated.userFilters, migrated.disabledBuiltinFilterIds);
  assert.equal(result[0].template, "NewHost = '${Host}'");
  assert.equal(result[0].enabled, false);
  assert.equal(result[1].template, "Host = 'fixed'");
  assert.equal(result[1].id, "user:host");
  assert.equal(migrated.userFilters[0].id, "host");
});
test("import is atomic, dialect-aware, rejects collisions, and roundtrips user data", () => {
  const options = { dialect: "test", normalize: item => item?.template ? { ...item } : null };
  const saved = exportFilterCatalog(builtins, "test");
  assert.deepEqual(importFilterCatalog(saved, [], options), builtins);
  assert.throws(() => importFilterCatalog(saved, builtins, options), /уже существует/);
  assert.throws(() => importFilterCatalog(saved, [], { ...options, dialect: "other" }), /язык/);
  assert.throws(() => importFilterCatalog('[{"id":"broken"}]', [], options), /недопустимый/);
  assert.throws(() => normalizeUserFilters([...builtins, ...builtins], options.normalize), /Повторяется/);
});
