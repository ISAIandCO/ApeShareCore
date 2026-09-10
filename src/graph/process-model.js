function referenceKey(host, reference) {
  return `${host}|${reference.kind}:${reference.value}`;
}

function addToIndex(index, key, node) {
  const values = index.get(key) ?? [];
  values.push(node);
  index.set(key, values);
}

function latestPrior(candidates, node, minimumTime = -Infinity) {
  if (!candidates?.length) return null;
  let low = 0;
  let high = candidates.length - 1;
  let match = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const candidate = candidates[middle];
    const prior = candidate.time < node.time || (candidate.time === node.time && candidate.order < node.order);
    if (prior) {
      match = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  const candidate = match >= 0 ? candidates[match] : null;
  return candidate && candidate.time >= minimumTime ? candidate : null;
}

function latestParent(candidates, node, minimumTime = -Infinity) {
  if (!candidates?.length) return null;
  let low = 0;
  let high = candidates.length - 1;
  let match = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (candidates[middle].time <= node.time) {
      match = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  while (match >= 0) {
    const candidate = candidates[match--];
    if (candidate.time < minimumTime) break;
    if (candidate !== node) return candidate;
  }
  return null;
}

function createsCycle(node, parent, nodes) {
  const visited = new Set([node.id]);
  let current = parent;
  while (current) {
    if (visited.has(current.id)) return true;
    visited.add(current.id);
    current = nodes.get(current.parentId);
  }
  return false;
}

function representsSourceProcess(event, source) {
  if (event.recordId && event.recordId === source.recordId && event.host === source.host) return true;
  if (event.host !== source.host) return false;
  const preferred = source.references.find(ref => ref.kind === "guid") ?? source.references[0];
  return Boolean(preferred && event.references.some(ref => ref.kind === preferred.kind && ref.value === preferred.value));
}
export function buildProcessGraph(events, { maxNodes = 1000, maxDepth = 64, pidParentWindowMs = 24 * 60 * 60_000, sourceEvent = null } = {}) {
  if (!Array.isArray(events)) return { nodes: [], roots: [], truncated: false };
  if (!events.length && !(sourceEvent?.references ?? []).length) return { nodes: [], roots: [], truncated: false };
  const sorted = [...events].sort((a, b) => a.time - b.time);
  const selected = sorted.slice(0, maxNodes);
  if ((sourceEvent?.references ?? []).length && !selected.some((event) => representsSourceProcess(event, sourceEvent))) {
    const exact = sorted.find((event) => String(sourceEvent.recordId ?? "") && event.host === sourceEvent.host && String(event.recordId ?? "") === String(sourceEvent.recordId)) ?? sourceEvent;
    if (selected.length >= maxNodes) selected[selected.length - 1] = exact;
    else selected.push(exact);
    selected.sort((a, b) => a.time - b.time);
  }
  const nodes = new Map();
  let order = 0;
  for (const event of selected) {
    const identity = event.identity;
    if (nodes.has(identity.id)) { nodes.get(identity.id).evidence.push(event.raw); continue; }
    const host = event.host;
    nodes.set(identity.id, {
      id: identity.id,
      identity,
      host,
      references: event.references,
      parentRefs: event.parentRefs,
      parentId: null,
      children: [],
      event: event.raw,
      fact: { ...event, raw: undefined },
      evidence: [event.raw],
      time: event.time,
      depth: 0,
      order: order++,
    });
  }
  const list = [...nodes.values()];
  const referenceIndex = new Map();
  for (const node of list) {
    for (const reference of node.references) addToIndex(referenceIndex, referenceKey(node.host, reference), node);
  }
  let parentIndexLookups = 0;
  for (const node of list) {
    if (!node.parentRefs.length) continue;
    let parent = null;
    for (const reference of [...node.parentRefs].sort((a, b) => Number(a.kind === "pid") - Number(b.kind === "pid"))) {
      parentIndexLookups += 1;
      const minimumTime = reference.kind === "pid" ? node.time - pidParentWindowMs : -Infinity;
      parent = latestParent(referenceIndex.get(referenceKey(node.host, reference)), node, minimumTime);
      if (parent) break;
    }
    if (parent && (parent.time !== node.time || !createsCycle(node, parent, nodes))) node.parentId = parent.id;
  }
  for (const node of list) {
    const parent = nodes.get(node.parentId);
    const depth = parent ? parent.depth + 1 : 0;
    if (depth >= maxDepth) {
      node.parentId = null;
      node.depth = 0;
    } else {
      node.depth = depth;
    }
  }
  for (const node of list) if (node.parentId) nodes.get(node.parentId)?.children.push(node.id);
  return {
    nodes: list,
    roots: list.filter((node) => !node.parentId).map((node) => node.id),
    truncated: events.length > maxNodes,
    diagnostics: {
      inputEvents: events.length,
      indexedNodes: list.length,
      referenceIndexKeys: referenceIndex.size,
      parentIndexLookups,
    },
  };
}

function closestProcessNode(nodes, reference, sourceTime, sourceHost) {
  const candidates = nodes
    .filter((node) => node.host === sourceHost && node.references.some((item) => item.kind === reference.kind && item.value === reference.value))
    .sort((a, b) => a.time - b.time || a.order - b.order);
  if (!candidates.length) return null;
  const virtualNode = { time: sourceTime, order: Number.MAX_SAFE_INTEGER };
  return latestPrior(candidates, virtualNode) ?? candidates[0];
}

export function findSourceProcessNodeId(graph, sourceEvent) {
  if (!Array.isArray(graph?.nodes) || !sourceEvent || typeof sourceEvent !== "object") return null;
  const sourceUuid = String(sourceEvent.recordId ?? "");
  const exact = sourceUuid && graph.nodes.find((node) => String(node.fact?.recordId ?? "") === sourceUuid && node.host === sourceEvent.host);
  if (exact) return exact.id;
  const references = sourceEvent.references;
  const sourceTime = sourceEvent.time;
  const sourceHost = sourceEvent.host;
  for (const kind of ["guid", "pid"]) {
    const reference = references.find((item) => item.kind === kind);
    const match = reference && closestProcessNode(graph.nodes, reference, sourceTime, sourceHost);
    if (match) return match.id;
  }
  return null;
}

export function selectProcessNeighborhood(graph, sourceNodeId, maxDistance = 2) {
  if (!Array.isArray(graph?.nodes) || !sourceNodeId) return { nodes: [], roots: [], truncated: false };
  const limit = Math.max(0, Math.min(64, Number(maxDistance) || 0));
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  if (!nodes.has(sourceNodeId)) return { nodes: [], roots: [], truncated: false };
  const adjacent = new Map(graph.nodes.map((node) => [node.id, []]));
  for (const node of graph.nodes) {
    if (!node.parentId || !nodes.has(node.parentId)) continue;
    adjacent.get(node.id).push(node.parentId);
    adjacent.get(node.parentId).push(node.id);
  }
  const selected = new Set([sourceNodeId]);
  const queue = [{ id: sourceNodeId, distance: 0 }];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor];
    if (current.distance >= limit) continue;
    for (const id of adjacent.get(current.id) ?? []) {
      if (selected.has(id)) continue;
      selected.add(id);
      queue.push({ id, distance: current.distance + 1 });
    }
  }
  const resultNodes = graph.nodes.filter((node) => selected.has(node.id)).map((node) => ({
    ...node,
    parentId: selected.has(node.parentId) ? node.parentId : null,
    children: [],
    depth: 0,
  }));
  const resultMap = new Map(resultNodes.map((node) => [node.id, node]));
  for (const node of resultNodes) if (node.parentId) resultMap.get(node.parentId)?.children.push(node.id);
  const roots = resultNodes.filter((node) => !node.parentId).map((node) => node.id);
  const depthQueue = roots.map((id) => ({ id, depth: 0 }));
  for (let cursor = 0; cursor < depthQueue.length; cursor += 1) {
    const current = depthQueue[cursor];
    const node = resultMap.get(current.id);
    if (!node) continue;
    node.depth = current.depth;
    for (const childId of node.children) depthQueue.push({ id: childId, depth: current.depth + 1 });
  }
  return { ...graph, nodes: resultNodes, roots, truncated: false };
}

export function selectDirectProcessRelatives(graph, sourceNodeId, direction = "both") {
  if (!Array.isArray(graph?.nodes) || !sourceNodeId) return [];
  if (!["parents", "children", "both", "siblings"].includes(direction)) throw new TypeError("Unknown process relation direction");
  const source = graph.nodes.find((node) => node.id === sourceNodeId);
  if (!source) return [];
  return graph.nodes.filter((node) => {
    if (direction === "siblings") return node.id !== source.id && Boolean(source.parentId) && node.parentId === source.parentId;
    if (["parents", "both"].includes(direction) && node.id === source.parentId) return true;
    return ["children", "both"].includes(direction) && node.parentId === source.id;
  });
}

export function orderProcessTree(graph) {
  if (!Array.isArray(graph?.nodes)) return [];
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const ordered = [];
  const visited = new Set();
  const visit = (node) => {
    if (!node || visited.has(node.id)) return;
    visited.add(node.id);
    ordered.push(node);
    const children = node.children.map((id) => nodes.get(id)).filter(Boolean).sort((a, b) => a.time - b.time);
    children.forEach(visit);
  };
  graph.roots.map((id) => nodes.get(id)).filter(Boolean).sort((a, b) => a.time - b.time).forEach(visit);
  graph.nodes.filter((node) => !visited.has(node.id)).sort((a, b) => a.time - b.time).forEach(visit);
  return ordered;
}
