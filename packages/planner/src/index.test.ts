import assert from "node:assert/strict";
import test from "node:test";

import {
  planDispatch,
  type CourierSnapshot,
  type DispatchOrder,
  type DispatchSnapshot,
  type PlannerSettings,
} from "./index.js";

const settings: PlannerSettings = {
  maxStopsPerRoute: 10,
  maxRouteDurationMs: 10_000,
  maxDetourMs: null,
};

function order(
  id: string,
  sequenceNumber: number,
  locationId = id,
  overrides: Partial<DispatchOrder> = {},
): DispatchOrder {
  return {
    id,
    receivedAtMs: 1_000,
    sequenceNumber,
    locationId,
    loadUnits: 1,
    serviceDurationMs: 0,
    slaAtMs: null,
    manualOverrideId: null,
    maxDetourMs: null,
    ...overrides,
  };
}

function courier(
  id: string,
  overrides: Partial<CourierSnapshot> = {},
): CourierSnapshot {
  return {
    id,
    activeLoad: 0,
    idleDurationMs: 0,
    shiftLoad: 0,
    pickupEtaMs: 0,
    capacityUnits: 10,
    route: {
      id: `route-${id}`,
      startLocationId: "hub",
      startsAtMs: 0,
      baseDurationMs: 0,
      stops: [],
    },
    ...overrides,
  };
}

function snapshot(
  orders: readonly DispatchOrder[],
  couriers: readonly CourierSnapshot[],
  travelTimeMs: DispatchSnapshot["travelTimeMs"],
  roadDistanceMeters?: NonNullable<DispatchSnapshot["roadDistanceMeters"]>,
  geographicDistanceMeters?: NonNullable<
    DispatchSnapshot["geographicDistanceMeters"]
  >,
): DispatchSnapshot {
  return {
    orders,
    couriers,
    travelTimeMs,
    ...(roadDistanceMeters === undefined ? {} : { roadDistanceMeters }),
    ...(geographicDistanceMeters === undefined
      ? {}
      : { geographicDistanceMeters }),
  };
}

test("sorts by immutable FIFO key and assigns anchors by courier rank", () => {
  const o1 = order("o1", 1, "a");
  const o2 = order("o2", 2, "b");
  const o3 = order("o3", 3, "c", { receivedAtMs: 2_000 });
  const c1 = courier("c1", {
    idleDurationMs: 100,
    shiftLoad: 1,
    pickupEtaMs: 5,
  });
  const c2 = courier("c2", {
    idleDurationMs: 200,
    shiftLoad: 9,
    pickupEtaMs: 1,
  });

  const result = planDispatch(
    snapshot([o3, o2, o1], [c1, c2], {
      hub: { a: 10, b: 10, c: 10 },
      a: { b: 10, c: 10 },
      b: { a: 10, c: 10 },
      c: { a: 10, b: 10 },
    }),
    settings,
  );

  assert.deepEqual(result.orderedOrderIds, ["o1", "o2", "o3"]);
  assert.deepEqual(
    result.assignments.slice(0, 2).map(({ orderId, courierId, kind }) => ({
      orderId,
      courierId,
      kind,
    })),
    [
      { orderId: "o1", courierId: "c2", kind: "ANCHOR" },
      { orderId: "o2", courierId: "c1", kind: "ANCHOR" },
    ],
  );
  assert.equal(result.assignments[2]?.kind, "INSERTION");
  assert.equal(result.stoppedAt, null);
});

test("uses minimum additional duration before courier balance for remaining orders", () => {
  const result = planDispatch(
    snapshot(
      [order("o1", 1, "a"), order("o2", 2, "b"), order("o3", 3, "c")],
      [
        courier("c1", { activeLoad: 0, idleDurationMs: 1_000 }),
        courier("c2", { activeLoad: 1, idleDurationMs: 0 }),
      ],
      {
        hub: { a: 10, b: 10, c: 10 },
        a: { b: 100, c: 100 },
        b: { a: 100, c: 5 },
        c: { a: 100, b: 100 },
      },
    ),
    settings,
  );

  assert.deepEqual(
    result.assignments.map(({ orderId, courierId }) => [orderId, courierId]),
    [
      ["o1", "c1"],
      ["o2", "c2"],
      ["o3", "c2"],
    ],
  );
  assert.equal(result.assignments[2]?.deltaDurationMs, 5);
});

test("breaks equal duration by smaller road-distance delta before balance", () => {
  const c1 = courier("c1", {
    activeLoad: 0,
    idleDurationMs: 1_000,
    route: {
      id: "route-c1",
      startLocationId: "start-c1",
      startsAtMs: 0,
      baseDurationMs: 0,
      stops: [],
    },
  });
  const c2 = courier("c2", {
    activeLoad: 5,
    idleDurationMs: 0,
    route: {
      id: "route-c2",
      startLocationId: "start-c2",
      startsAtMs: 0,
      baseDurationMs: 0,
      stops: [],
    },
  });

  const result = planDispatch(
    snapshot(
      [order("o1", 1, "a")],
      [c1, c2],
      {
        "start-c1": { a: 10 },
        "start-c2": { a: 10 },
      },
      {
        "start-c1": { a: 1_000 },
        "start-c2": { a: 100 },
      },
    ),
    settings,
  );

  assert.equal(result.assignments[0]?.courierId, "c2");
  assert.equal(result.assignments[0]?.deltaDurationMs, 10);
  assert.equal(result.assignments[0]?.deltaDistanceMeters, 100);
  assert.equal(result.routes.find(({ courierId }) => courierId === "c2")?.distanceMeters, 100);
});

test("enforces courier-specific capacity_stops before the global ceiling", () => {
  const result = planDispatch(
    snapshot(
      [order("o1", 1, "a"), order("o2", 2, "b")],
      [courier("c1", { maxStops: 1 })],
      {
        hub: { a: 5, b: 5 },
        a: { b: 5 },
        b: { a: 5 },
      },
    ),
    settings,
  );

  assert.deepEqual(result.assignments.map(({ orderId }) => orderId), ["o1"]);
  assert.equal(result.stoppedAt?.orderId, "o2");
  assert.ok(
    result.stoppedAt?.reasons.includes("COURIER_MAX_STOPS_EXCEEDED"),
  );
  assert.ok(!result.stoppedAt?.reasons.includes("MAX_STOPS_EXCEEDED"));
});

test("does not apply grouping radius to FIFO anchors but rejects a distant insertion", () => {
  const result = planDispatch(
    snapshot(
      [order("o1", 1, "a"), order("o2", 2, "b")],
      [courier("c1")],
      {
        hub: { a: 5, b: 5 },
        a: { b: 5 },
        b: { a: 5 },
      },
      undefined,
      {
        a: { b: 101 },
        b: { a: 101 },
      },
    ),
    { ...settings, groupingRadiusMeters: 100 },
  );

  assert.deepEqual(
    result.assignments.map(({ orderId, kind }) => [orderId, kind]),
    [["o1", "ANCHOR"]],
  );
  assert.equal(result.stoppedAt?.orderId, "o2");
  assert.ok(result.stoppedAt?.reasons.includes("GROUPING_RADIUS_EXCEEDED"));
});

test("rejects insertion above maxAdditionalDistanceMeters", () => {
  const result = planDispatch(
    snapshot(
      [order("o1", 1, "a"), order("o2", 2, "b")],
      [courier("c1")],
      {
        hub: { a: 5, b: 5 },
        a: { b: 5 },
        b: { a: 5 },
      },
      {
        hub: { a: 5, b: 5 },
        a: { b: 11 },
        b: { a: 11 },
      },
    ),
    { ...settings, maxAdditionalDistanceMeters: 10 },
  );

  assert.deepEqual(result.assignments.map(({ orderId }) => orderId), ["o1"]);
  assert.equal(result.assignments[0]?.deltaDistanceMeters, 5);
  assert.equal(result.stoppedAt?.orderId, "o2");
  assert.ok(
    result.stoppedAt?.reasons.includes(
      "MAX_ADDITIONAL_DISTANCE_EXCEEDED",
    ),
  );
});

test("stops at the first infeasible FIFO head and leaves its tail untouched", () => {
  const result = planDispatch(
    snapshot(
      [order("o1", 1, "a"), order("o2", 2, "b"), order("o3", 3, "c")],
      [courier("c1", { capacityUnits: 1 })],
      {
        hub: { a: 1, b: 1, c: 1 },
        a: { b: 1, c: 1 },
        b: { a: 1, c: 1 },
        c: { a: 1, b: 1 },
      },
    ),
    settings,
  );

  assert.deepEqual(result.assignments.map(({ orderId }) => orderId), ["o1"]);
  assert.equal(result.stoppedAt?.orderId, "o2");
  assert.ok(result.stoppedAt?.reasons.includes("CAPACITY_EXCEEDED"));
  assert.deepEqual(result.unplannedOrderIds, ["o2", "o3"]);
  assert.deepEqual(result.routes[0]?.stops.map(({ id }) => id), ["o1"]);
});

test("preserves automatic FIFO inside a route even when an earlier slot is faster", () => {
  const older = order("older", 1, "a");
  const newer = order("newer", 2, "b");
  const c1 = courier("c1", {
    route: {
      id: "route-c1",
      startLocationId: "hub",
      startsAtMs: 0,
      baseDurationMs: 0,
      stops: [older],
    },
  });

  const result = planDispatch(
    snapshot([newer], [c1], {
      hub: { a: 10, b: 5 },
      a: { b: 100 },
      b: { a: 5 },
    }),
    settings,
  );

  assert.equal(result.assignments[0]?.insertionIndex, 1);
  assert.deepEqual(result.routes[0]?.stops.map(({ id }) => id), [
    "older",
    "newer",
  ]);
});

test("an audited manual override can create an explicit FIFO exception", () => {
  const older = order("older", 1, "a");
  const newer = order("newer", 2, "b", {
    manualOverrideId: "override-42",
  });
  const c1 = courier("c1", {
    route: {
      id: "route-c1",
      startLocationId: "hub",
      startsAtMs: 0,
      baseDurationMs: 0,
      stops: [older],
    },
  });

  const result = planDispatch(
    snapshot([newer], [c1], {
      hub: { a: 10, b: 5 },
      a: { b: 100 },
      b: { a: 5 },
    }),
    settings,
  );

  assert.equal(result.assignments[0]?.insertionIndex, 0);
  assert.deepEqual(result.assignments[0]?.manualOverrideIds, ["override-42"]);
  assert.deepEqual(result.routes[0]?.stops.map(({ id }) => id), [
    "newer",
    "older",
  ]);
});

test("reports stop, duration, SLA and detour constraint failures", async (t) => {
  const existing = order("existing", 2, "a", {
    slaAtMs: 1_000,
    maxDetourMs: 0,
  });
  const pending = order("pending", 1, "b", { slaAtMs: 6 });
  const baseCourier = courier("c1", {
    route: {
      id: "route-c1",
      startLocationId: "hub",
      startsAtMs: 0,
      baseDurationMs: 0,
      stops: [existing],
    },
  });
  const matrix = {
    hub: { a: 10, b: 5 },
    a: { b: 10 },
    b: { a: 10 },
  };

  await t.test("maximum stops", () => {
    const result = planDispatch(
      snapshot([pending], [baseCourier], matrix),
      { ...settings, maxStopsPerRoute: 1 },
    );
    assert.ok(result.stoppedAt?.reasons.includes("MAX_STOPS_EXCEEDED"));
  });

  await t.test("maximum route duration", () => {
    const result = planDispatch(
      snapshot([pending], [baseCourier], matrix),
      { ...settings, maxRouteDurationMs: 14 },
    );
    assert.ok(
      result.stoppedAt?.reasons.includes("MAX_ROUTE_DURATION_EXCEEDED"),
    );
  });

  await t.test("SLA", () => {
    const result = planDispatch(
      snapshot([pending], [baseCourier], matrix),
      settings,
    );
    assert.ok(result.stoppedAt?.reasons.includes("SLA_EXCEEDED"));
  });

  await t.test("detour", () => {
    const result = planDispatch(
      snapshot(
        [order("pending", 1, "b", { slaAtMs: null })],
        [baseCourier],
        matrix,
      ),
      settings,
    );
    assert.ok(result.stoppedAt?.reasons.includes("MAX_DETOUR_EXCEEDED"));
  });
});

test("is deterministic across permutations of input arrays", () => {
  const orders = [order("o3", 3, "c"), order("o1", 1, "a"), order("o2", 2, "b")];
  const couriers = [courier("c2"), courier("c1")];
  const matrix = {
    hub: { a: 10, b: 10, c: 10 },
    a: { b: 10, c: 10 },
    b: { a: 10, c: 10 },
    c: { a: 10, b: 10 },
  };

  const first = planDispatch(snapshot(orders, couriers, matrix), settings);
  const second = planDispatch(
    snapshot(orders.slice().reverse(), couriers.slice().reverse(), matrix),
    settings,
  );

  assert.deepEqual(second, first);
});
