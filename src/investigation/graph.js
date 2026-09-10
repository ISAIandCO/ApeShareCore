export function createInvestigationGraph({ eventIdentity, eventRef = item => item.sourceEventUuid, sourceRef = item => item.sourceEventUuid, investigationEventTime, describeInvestigationEvent, extractedEntities, standaloneEntity = () => null }) {
const canonical = value => String(value).normalize("NFKC").toLocaleLowerCase();
function buildInvestigationGraph(items, { sharedOnly = false } = {}) {
  const nodes = new Map();
  const edges = new Map();
  const eventsByUuid = new Map();
  const eventItems = (Array.isArray(items) ? items : []).map((item, index) => ({ item, index })).filter(({ item }) => item.type === "event");

  for (const { item, index } of eventItems) {
    const identity = eventIdentity(item, index);
    const id = `event:${identity}`;
    const view = describeInvestigationEvent(item.snapshot);
    nodes.set(id, { id, kind: "event", label: view.title, description: view.description, itemIndex: index, event: item.snapshot, time: investigationEventTime(item) });
    if (eventRef(item)) eventsByUuid.set(String(eventRef(item)), id);
    for (const entity of extractedEntities(item.snapshot)) {
      const entityId = `entity:${entity.spec.key}:${canonical(entity.value)}`;
      if (!nodes.has(entityId)) nodes.set(entityId, {
        id: entityId, kind: "entity", entityType: entity.spec.type, entityKey: entity.spec.key,
        typeLabel: entity.spec.label, label: entity.value, queryFields: entity.spec.fields, queryValue: entity.value,
      });
      const edgeId = `${id}|${entityId}`;
      if (!edges.has(edgeId)) edges.set(edgeId, { sourceId: id, targetId: entityId, fields: [] });
      const edge = edges.get(edgeId);
      if (!edge.fields.includes(entity.field)) edge.fields.push(entity.field);
    }
  }

  for (const [index, item] of (Array.isArray(items) ? items : []).entries()) {
    if (item.type === "event") continue;
    const entity = standaloneEntity(item);
    if (!entity) continue;
    const entityId = `entity:${entity.spec.key}:${canonical(entity.value)}`;
    if (!nodes.has(entityId)) nodes.set(entityId, {
      id: entityId, kind: "entity", entityType: entity.spec.type, entityKey: entity.spec.key,
      typeLabel: entity.spec.label, label: entity.value, queryFields: entity.spec.fields, queryValue: entity.value, itemIndex: index,
    });
    const sourceId = sourceRef(item) && eventsByUuid.get(String(sourceRef(item)));
    if (sourceId) edges.set(`${sourceId}|${entityId}`, { sourceId, targetId: entityId, fields: entity.field ? [entity.field] : [] });
  }

  const degrees = new Map();
  for (const edge of edges.values()) {
    degrees.set(edge.sourceId, (degrees.get(edge.sourceId) ?? 0) + 1);
    degrees.set(edge.targetId, (degrees.get(edge.targetId) ?? 0) + 1);
  }
  const visibleNodes = [...nodes.values()].filter((node) => !sharedOnly || node.kind === "event" || (degrees.get(node.id) ?? 0) > 1);
  const visibleIds = new Set(visibleNodes.map((node) => node.id));
  const visibleEdges = [...edges.values()].filter((edge) => visibleIds.has(edge.sourceId) && visibleIds.has(edge.targetId));
  const visibleDegrees = new Map();
  for (const edge of visibleEdges) {
    visibleDegrees.set(edge.sourceId, (visibleDegrees.get(edge.sourceId) ?? 0) + 1);
    visibleDegrees.set(edge.targetId, (visibleDegrees.get(edge.targetId) ?? 0) + 1);
  }
  for (const node of visibleNodes) node.connectionCount = visibleDegrees.get(node.id) ?? 0;
  return { nodes: visibleNodes, edges: visibleEdges };
}

return buildInvestigationGraph;
}
