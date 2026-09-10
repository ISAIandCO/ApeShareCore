import { buildProcessGraph as build, findSourceProcessNodeId as find, selectProcessNeighborhood, selectDirectProcessRelatives } from "./process-model.js";
import { createProcessPagination } from "./progressive.js";

export function createProcessWorkflow(adapter, settings) {
  const client = { origin: adapter.origin, searchEvents: adapter.searchPage };
  const { deduplicateProcessEvents, prioritizeProcessEvents, seedProcessRange, expansionRanges, mergeLoadedRanges, fetchProcessPages, runProcessRangeQueries } = createProcessPagination({
    identity: event => { const fact = adapter.normalize(event); return fact.recordId ? JSON.stringify([fact.host, fact.recordId]) : fact.identity.id; },
    time: event => adapter.normalize(event).time,
  });
  const buildProcessGraph = (events, options) => build(events.map(adapter.normalize).filter(Boolean), { ...options, sourceEvent: adapter.normalize(options.sourceEvent) });
  const findSourceProcessNodeId = (graph, event) => find(graph, adapter.normalize(event));
  const buildProcessSearchPredicate = host => ({ kind: "processes", host });
  const buildProcessRelationPredicate = (events, direction) => ({ kind: "relations", events: Array.isArray(events) ? events : [events], direction });
  const buildProcessFocusPredicate = event => buildProcessRelationPredicate(event, "both");
  const fetchScopedProcessPages = (_client, _settings, query, options) => fetchProcessPages(client, query, options);
async function buildProcessContext(client, event, settings, mode = "broad", signal) {
  if (mode === "step") return buildStepProcessContext(client, event, settings, signal);
  const host = adapter.normalize(event).host;
  if (!host) return { ok: false, kind: "feature-unavailable", error: "Current event has no process host" };
  const where = buildProcessSearchPredicate(host);
  const focusWhere = buildProcessFocusPredicate(event);
  const range = seedProcessRange(adapter.normalize(event).time, settings.process.seedWindowSeconds);
  const select = undefined;
  const fetchQuery = async (queryWhere, maxEvents) => {
    const request = (requestScope) => fetchProcessPages(client, {
      where: queryWhere, select, ...range, scope: requestScope,
    }, { pageSize: settings.process.pageSize, maxEvents, signal });
    try {
      return await request(undefined);
    } catch (error) {
      throw error;
    }
  };
  const [result, focused] = await Promise.all([
    fetchQuery(where, settings.process.maxNodes),
    focusWhere === where
      ? { events: [], pages: 0, limitReached: false }
      : fetchQuery(focusWhere, Math.min(250, settings.process.maxNodes)).catch(() => ({ events: [], pages: 0, limitReached: false })),
  ]);
  const events = prioritizeProcessEvents(focused.events, result.events, settings.process.maxNodes);
  const graph = buildProcessGraph(events, { ...settings.process, sourceEvent: event });
  return {
    ok: true,
    graph,
    origin: client.origin,
    sourceEvent: event,
    sourceUuid: adapter.normalize(event).recordId ?? null,
    sourceNodeId: findSourceProcessNodeId(graph, event),
    queryMetadata: {
      where,
      timeFrom: range.timeFrom,
      timeTo: range.timeTo,
      loadedRanges: [{ from: range.timeFrom, to: range.timeTo }],
      maxNodes: settings.process.maxNodes,
      pageSize: settings.process.pageSize,
      expansionStepSeconds: settings.process.expansionStepSeconds,
      pages: result.pages + focused.pages,
      focusedEvents: focused.events.length,
      pendingRanges: result.limitReached ? [{ direction: "seed", ...range, offset: result.nextOffset }] : [],
      partial: true,
      limitReached: result.limitReached || graph.truncated,
      searchScope: settings.searchScope.mode,
    },
  };
}

async function buildStepProcessContext(client, event, settings, signal) {
  const host = adapter.normalize(event).host;
  if (!host) return { ok: false, kind: "feature-unavailable", error: "Current event has no process host" };
  const range = seedProcessRange(adapter.normalize(event).time, 3600);
  const select = undefined;
  const directWhere = buildProcessRelationPredicate(event, "both");
  const direct = await fetchScopedProcessPages(client, settings, { where: directWhere, select, ...range }, {
    pageSize: settings.process.pageSize,
    maxEvents: Math.min(500, settings.process.maxNodes), signal,
  });
  const directGraph = buildProcessGraph(direct.events, { ...settings.process, sourceEvent: event });
  const directSourceNodeId = findSourceProcessNodeId(directGraph, event);
  const directNeighborhood = selectProcessNeighborhood(directGraph, directSourceNodeId, 1);
  const relationEvents = directNeighborhood.nodes.map((node) => node.event);
  const secondWhere = buildProcessRelationPredicate(relationEvents.length ? relationEvents : [event], "both");
  const second = await fetchScopedProcessPages(client, settings, { where: secondWhere, select, ...range }, {
    pageSize: settings.process.pageSize,
    maxEvents: settings.process.maxNodes, signal,
  });
  const events = deduplicateProcessEvents(direct.events, second.events).slice(0, settings.process.maxNodes);
  const completeGraph = buildProcessGraph(events, { ...settings.process, sourceEvent: event });
  const sourceNodeId = findSourceProcessNodeId(completeGraph, event);
  const graph = selectProcessNeighborhood(completeGraph, sourceNodeId, 2);
  return {
    ok: true,
    graph,
    origin: client.origin,
    sourceEvent: event,
    sourceUuid: adapter.normalize(event).recordId ?? null,
    sourceNodeId,
    queryMetadata: {
      mode: "step",
      where: secondWhere,
      timeFrom: range.timeFrom,
      timeTo: range.timeTo,
      loadedRanges: [{ from: range.timeFrom, to: range.timeTo }],
      maxNodes: settings.process.maxNodes,
      pageSize: settings.process.pageSize,
      expansionStepSeconds: 3600,
      pages: direct.pages + second.pages,
      pendingRanges: [],
      partial: true,
      limitReached: direct.limitReached || second.limitReached,
      searchScope: settings.searchScope.mode,
    },
  };
}

async function expandProcessContext(client, currentEvent, settings, message, signal) {
  const sourceEvent = message.sourceEvent && typeof message.sourceEvent === "object" ? message.sourceEvent : currentEvent;
  const host = adapter.normalize(sourceEvent).host;
  if (!host) return { ok: false, kind: "feature-unavailable", error: "Source event has no process host" };
  const existing = deduplicateProcessEvents(message.existingEvents);
  const nodeLimit = Math.min(10_000, Math.max(settings.process.maxNodes, Number(message.nodeLimit) || settings.process.maxNodes));
  const previousPending = Array.isArray(message.queryMetadata?.pendingRanges) ? message.queryMetadata.pendingRanges : [];
  const requestedRanges = message.resumeLimit && previousPending.length
    ? previousPending.map(({ direction, timeFrom, timeTo, offset }) => ({ direction, timeFrom, timeTo, offset }))
    : expansionRanges(message.queryMetadata, message.direction, Number(message.stepSeconds) || settings.process.expansionStepSeconds)
      .map((range) => ({ ...range, direction: message.direction, offset: 0 }));
  const remaining = Math.max(0, nodeLimit - existing.length);
  const ranges = remaining ? requestedRanges : [];
  let results = [];
  if (remaining) {
    const query = { where: buildProcessSearchPredicate(host), select: undefined, scope: undefined };
    const request = (requestQuery) => runProcessRangeQueries(client, ranges, requestQuery, {
      concurrency: settings.process.queryConcurrency,
      pageSize: settings.process.pageSize,
      maxEvents: Math.max(1, Math.ceil(remaining / ranges.length)),
      signal,
    });
    try {
      results = await request(query);
    } catch (error) {
      throw error;
    }
  }
  const incoming = results.flatMap((result) => result.events);
  const events = deduplicateProcessEvents(existing, incoming).slice(0, nodeLimit);
  const graph = buildProcessGraph(events, { ...settings.process, maxNodes: nodeLimit, sourceEvent });
  const loadedRanges = mergeLoadedRanges(message.queryMetadata?.loadedRanges, ranges);
  const nextPending = results.flatMap((result, index) => result.limitReached ? [{
    direction: ranges[index].direction,
    timeFrom: ranges[index].timeFrom,
    timeTo: ranges[index].timeTo,
    offset: result.nextOffset,
  }] : []);
  const pendingByRange = new Map((message.resumeLimit ? nextPending : [...previousPending, ...nextPending]).map((range) => [
    `${range.timeFrom}\n${range.timeTo}`,
    range,
  ]));
  const pendingRanges = [...pendingByRange.values()];
  const timeFrom = loadedRanges[0]?.from ?? message.queryMetadata?.timeFrom;
  const timeTo = loadedRanges.at(-1)?.to ?? message.queryMetadata?.timeTo;
  const limitReached = events.length >= nodeLimit || pendingRanges.length > 0 || graph.truncated;
  return {
    ok: true,
    graph,
    origin: client.origin,
    sourceEvent,
    sourceUuid: adapter.normalize(sourceEvent).recordId ?? null,
    sourceNodeId: findSourceProcessNodeId(graph, sourceEvent),
    queryMetadata: {
      ...message.queryMetadata,
      where: buildProcessSearchPredicate(host),
      timeFrom,
      timeTo,
      loadedRanges,
      maxNodes: nodeLimit,
      pageSize: settings.process.pageSize,
      pages: Number(message.queryMetadata?.pages ?? 0) + results.reduce((total, result) => total + result.pages, 0),
      pendingRanges,
      partial: true,
      limitReached,
      lastDirection: message.direction,
      searchScope: settings.searchScope.mode,
    },
  };
}

async function expandProcessNode(client, currentEvent, settings, message, signal) {
  const sourceEvent = message.sourceEvent && typeof message.sourceEvent === "object" ? message.sourceEvent : currentEvent;
  const nodeEvent = message.nodeEvent && typeof message.nodeEvent === "object" ? message.nodeEvent : null;
  if (!nodeEvent || !adapter.normalize(nodeEvent).host) return { ok: false, kind: "feature-unavailable", error: "Node event has no process host" };
  const direction = ["parents", "children", "both", "siblings"].includes(message.direction) ? message.direction : "both";
  const existing = deduplicateProcessEvents(message.existingEvents);
  const nodeLimit = Math.min(10_000, Math.max(settings.process.maxNodes, Number(message.nodeLimit) || settings.process.maxNodes));
  const remaining = Math.max(0, nodeLimit - existing.length);
  const range = seedProcessRange(adapter.normalize(nodeEvent).time, Number(message.stepSeconds) || 3600);
  const where = buildProcessRelationPredicate(nodeEvent, direction);
  const result = remaining ? await fetchScopedProcessPages(client, settings, {
    where,
    select: undefined,
    ...range,
  }, { pageSize: settings.process.pageSize, maxEvents: remaining, signal }) : { events: [], pages: 0, limitReached: true };
  const candidateEvents = deduplicateProcessEvents(existing, result.events).slice(0, nodeLimit);
  const candidateGraph = buildProcessGraph(candidateEvents, { ...settings.process, maxNodes: nodeLimit, sourceEvent });
  const nodeId = findSourceProcessNodeId(candidateGraph, nodeEvent);
  const relatedEvents = selectDirectProcessRelatives(candidateGraph, nodeId, direction).map((node) => node.event);
  const events = deduplicateProcessEvents(existing, relatedEvents).slice(0, nodeLimit);
  const graph = buildProcessGraph(events, { ...settings.process, maxNodes: nodeLimit, sourceEvent });
  const loadedRanges = mergeLoadedRanges(message.queryMetadata?.loadedRanges, [range]);
  return {
    ok: true,
    graph,
    origin: client.origin,
    sourceEvent,
    sourceUuid: adapter.normalize(sourceEvent).recordId ?? null,
    sourceNodeId: findSourceProcessNodeId(graph, sourceEvent),
    queryMetadata: {
      ...message.queryMetadata,
      mode: "step",
      where,
      timeFrom: loadedRanges[0]?.from ?? range.timeFrom,
      timeTo: loadedRanges.at(-1)?.to ?? range.timeTo,
      loadedRanges,
      maxNodes: nodeLimit,
      pageSize: settings.process.pageSize,
      pages: Number(message.queryMetadata?.pages ?? 0) + result.pages,
      pendingRanges: [],
      partial: true,
      limitReached: events.length >= nodeLimit || result.limitReached || graph.truncated,
      lastDirection: direction,
      searchScope: settings.searchScope.mode,
    },
  };
}

return {
  load: (event, mode, signal) => buildProcessContext(client, event, settings, mode, signal),
  expand: (event, message, signal) => expandProcessContext(client, event, settings, message, signal),
  expandNode: (event, message, signal) => expandProcessNode(client, event, settings, message, signal),
};
}
