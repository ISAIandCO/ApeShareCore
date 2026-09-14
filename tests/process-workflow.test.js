import test from "node:test";
import assert from "node:assert/strict";
import { buildProcessGraph } from "../src/graph/process-model.js";
import { createProcessWorkflow } from "../src/graph/workflow.js";
import { filterProcessNodes } from "../src/graph/filters.js";

const fact = (id, pid, parent, time, host = "host") => ({
  raw: { id, pid, parent, time, host }, recordId: id, host, time,
  identity: { id, kind: "pid", value: pid }, references: [{ kind: "pid", value: pid }],
  parentRefs: parent ? [{ kind: "pid", value: parent }] : [],
});
const normalize = event => fact(event.id, event.pid, event.parent, event.time, event.host);
const settings = { process: { maxNodes: 1000, maxDepth: 64, pageSize: 250, queryConcurrency: 2, seedWindowSeconds: 900, expansionStepSeconds: 3600 }, searchScope: { mode: "default" } };

test("shared process model isolates hosts and chooses the latest earlier PID lifetime", () => {
  const graph = buildProcessGraph([fact("old", "1", null, 1000), fact("new", "1", null, 2000), fact("foreign", "1", null, 2500, "other"), fact("child", "2", "1", 3000)]);
  assert.equal(graph.nodes.find(node => node.id === "child").parentId, "new");
});

test("GUID evidence is retained without duplicate graph nodes or input mutations", () => {
  const first = { ...fact("a", "1", null, 1000), identity: { id: "g", kind: "guid", value: "g" } };
  const second = { ...fact("b", "1", null, 2000), identity: first.identity };
  const before = structuredClone([first, second]);
  const graph = buildProcessGraph([first, second]);
  assert.equal(graph.nodes.length, 1);
  assert.deepEqual(graph.nodes[0].evidence.map(event => event.id), ["a", "b"]);
  assert.deepEqual([first, second], before);
});

test("ancestor filtering terminates on cyclic imported graphs", () => {
  assert.deepEqual([...filterProcessNodes([{ id: "a", parentId: "b" }, { id: "b", parentId: "a" }], { relations: "ancestors" }, "a")], ["a", "b"]);
});

test("step workflow makes two relation passes and discards unrelated candidates", async () => {
  const source = fact("source", "2", "1", Date.parse("2026-09-01T10:01:00Z")).raw;
  const parent = fact("parent", "1", null, source.time - 60000).raw;
  const child = fact("child", "3", "2", source.time + 60000).raw;
  const unrelated = fact("unrelated", "9", null, source.time).raw;
  const queries = [];
  const workflow = createProcessWorkflow({ normalize, origin: "https://example.test", searchPage: async query => {
    queries.push(query); return { events: queries.length === 1 ? [parent, unrelated] : [child, unrelated] };
  } }, settings);
  const result = await workflow.load(source, "step");
  assert.deepEqual(result.graph.nodes.map(node => node.id).sort(), ["child", "parent", "source"]);
  assert.equal(queries.length, 2);
  assert.ok(queries.every(query => query.where.kind === "relations"));
  assert.equal(result.sourceNodeId, "source");
});

test("aborted expansion does not request or alter graph data", async () => {
  const source = fact("s", "1", null, Date.parse("2026-09-01T10:00:00Z")).raw;
  const controller = new AbortController(); controller.abort();
  const workflow = createProcessWorkflow({ normalize, searchPage: () => assert.fail("Unexpected query") }, settings);
  await assert.rejects(workflow.expandNode(source, { nodeEvent: source, sourceEvent: source, existingEvents: [source], direction: "children" }, controller.signal), { name: "AbortError" });
});

test("investigation range spans all event times using the shared ISO UTC contract", async () => {
  const { rangeAroundEvents } = await import("../src/values/time.js");
  assert.deepEqual(rangeAroundEvents([{ time: "2026-09-09T10:00:00Z" }, { time: "2026-09-09T12:00:00Z" }], event => event.time, 900), {
    from: "2026-09-09T09:45:00.000Z", to: "2026-09-09T12:15:00.000Z",
  });
});

test("a different event with the same PID must not replace the source process", async () => {
  const source = fact("who", "1713", "333153", Date.parse("2026-09-14T10:20:59Z"));
  const other = fact("bash", "1713", "100", source.time - 60000);
  const graph = buildProcessGraph([other], { sourceEvent: source });
  assert.ok(graph.nodes.some(node => node.id === "who"));
  const workflow = createProcessWorkflow({ normalize, searchPage: async () => ({ events: [other.raw], exhausted: true }) }, settings);
  const result = await workflow.load(source.raw, "step");
  assert.equal(result.sourceNodeId, "who");
  assert.equal(result.graph.nodes.find(node => node.id === result.sourceNodeId).event.id, "who");
});

test("source preservation also applies when the graph reaches its node limit", () => {
  const source = fact("source", "20", null, 2000);
  const other = fact("other", "20", null, 1000);
  const graph = buildProcessGraph([other], { maxNodes: 1, sourceEvent: source });
  assert.deepEqual(graph.nodes.map(node => node.id), ["source"]);
});

test("stable GUID evidence still shares a single process node", () => {
  const source = fact("source", "20", null, 2000);
  const other = fact("other", "20", null, 1000);
  for (const item of [source, other]) {
    item.identity = { id: "guid:process", kind: "guid", value: "process" };
    item.references.unshift({ kind: "guid", value: "process" });
  }
  const graph = buildProcessGraph([other], { sourceEvent: source });
  assert.deepEqual(graph.nodes.map(node => node.id), ["guid:process"]);
});
