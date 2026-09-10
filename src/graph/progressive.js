import { parseSiemTime } from "../values/time.js";

export const PROCESS_DIRECTIONS = Object.freeze(["parents", "children", "both", "siblings", "previous", "next"]);

export function createProcessPagination({ identity, time }) {
const eventKey = identity;
function deduplicateProcessEvents(...batches) {
  const events = new Map();
  for (const batch of batches) {
    for (const event of Array.isArray(batch) ? batch : []) {
      if (event && typeof event === "object") events.set(eventKey(event), event);
    }
  }
  return [...events.values()].sort((first, second) => {
    const firstTime = time(first) ?? 0;
    const secondTime = time(second) ?? 0;
    return firstTime - secondTime || eventKey(first).localeCompare(eventKey(second));
  });
}

function prioritizeProcessEvents(priority, remaining, limit) {
  const priorityKeys = new Set((Array.isArray(priority) ? priority : []).map(eventKey));
  const events = deduplicateProcessEvents(priority, remaining);
  const ordered = [...events.filter((event) => priorityKeys.has(eventKey(event))), ...events.filter((event) => !priorityKeys.has(eventKey(event)))];
  return ordered.slice(0, Math.max(1, Number(limit) || 1000));
}

function seedProcessRange(eventTime, windowSeconds = 900) {
  const center = parseSiemTime(eventTime)?.valueOf();
  if (!Number.isFinite(center)) throw new TypeError("Current event has no valid timestamp");
  const radius = Math.max(60, Math.min(86400, Number(windowSeconds) || 900)) * 1000;
  return { timeFrom: new Date(center - radius).toISOString(), timeTo: new Date(center + radius).toISOString() };
}

function expansionRanges(metadata, direction, stepSeconds = 3600) {
  if (!PROCESS_DIRECTIONS.includes(direction)) throw new TypeError("Unknown process expansion direction");
  const start = Date.parse(metadata?.timeFrom);
  const end = Date.parse(metadata?.timeTo);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) throw new TypeError("Invalid loaded process range");
  const step = Math.max(300, Math.min(86400, Number(stepSeconds) || 3600)) * 1000;
  const previous = { timeFrom: new Date(start - step).toISOString(), timeTo: new Date(start).toISOString() };
  const next = { timeFrom: new Date(end).toISOString(), timeTo: new Date(end + step).toISOString() };
  if (["parents", "previous"].includes(direction)) return [previous];
  if (["children", "next"].includes(direction)) return [next];
  return [previous, next];
}

function mergeLoadedRanges(existing, additions) {
  const ranges = [...(Array.isArray(existing) ? existing : []), ...(Array.isArray(additions) ? additions : [])]
    .map((range) => ({ from: Date.parse(range.from ?? range.timeFrom), to: Date.parse(range.to ?? range.timeTo) }))
    .filter((range) => Number.isFinite(range.from) && Number.isFinite(range.to) && range.from < range.to)
    .sort((first, second) => first.from - second.from);
  const merged = [];
  for (const range of ranges) {
    const previous = merged.at(-1);
    if (previous && range.from <= previous.to) previous.to = Math.max(previous.to, range.to);
    else merged.push({ ...range });
  }
  return merged.map((range) => ({ from: new Date(range.from).toISOString(), to: new Date(range.to).toISOString() }));
}

function responseEvents(response) {
  return Array.isArray(response) ? response : Array.isArray(response?.events) ? response.events : [];
}

async function fetchProcessPages(client, query, {
  pageSize = 250,
  maxEvents = 1000,
  startOffset = 0,
  signal,
} = {}) {
  const size = Math.max(25, Math.min(1000, Number(pageSize) || 250));
  const limit = Math.max(1, Math.min(20_000, Number(maxEvents) || 1000));
  const collected = [];
  const seen = new Set();
  let offset = Math.max(0, Number(startOffset) || 0);
  let pages = 0;
  let exhausted = false;
  let serverLimited = false;
  let consecutiveDuplicatePages = 0;
  const pageBudget = Math.ceil(limit / size) * 4 + 10;
  while (collected.length < limit && !exhausted && pages < pageBudget) {
    if (signal?.aborted) throw signal.reason ?? new DOMException("Process query was cancelled", "AbortError");
    const response = await client.searchEvents({ ...query, limit: Math.min(size, limit - collected.length), offset, signal });
    if (signal?.aborted) throw signal.reason ?? new DOMException("Process query was cancelled", "AbortError");
    const page = responseEvents(response);
    serverLimited ||= response?.limitReached === true;
    pages += 1;
    let added = 0;
    for (const event of page) {
      const key = eventKey(event);
      if (seen.has(key)) continue;
      seen.add(key);
      collected.push(event);
      added += 1;
      if (collected.length >= limit) break;
    }
    consecutiveDuplicatePages = added ? 0 : consecutiveDuplicatePages + 1;
    exhausted = response?.exhausted === true || page.length < Math.min(size, limit - (collected.length - added)) || page.length === 0 || consecutiveDuplicatePages >= 3;
    offset += page.length;
  }
  return { events: collected, pages, exhausted, nextOffset: offset, limitReached: serverLimited || !exhausted && (collected.length >= limit || pages >= pageBudget) };
}

async function runProcessRangeQueries(client, ranges, query, {
  concurrency = 2,
  pageSize = 250,
  maxEvents = 1000,
  signal,
} = {}) {
  const tasks = ranges.map((range) => async () => {
    const { offset = 0, ...queryRange } = range;
    return fetchProcessPages(client, { ...query, ...queryRange }, { pageSize, maxEvents, startOffset: offset, signal });
  });
  const results = new Array(tasks.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < tasks.length) {
      if (signal?.aborted) throw signal.reason ?? new DOMException("Process query was cancelled", "AbortError");
      const index = cursor++;
      results[index] = await tasks[index]();
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), tasks.length || 1) }, worker));
  return results;
}

return { deduplicateProcessEvents, prioritizeProcessEvents, seedProcessRange, expansionRanges, mergeLoadedRanges, fetchProcessPages, runProcessRangeQueries };
}
