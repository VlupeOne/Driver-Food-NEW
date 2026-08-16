import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  planDispatch,
  type CourierSnapshot,
  type DispatchOrder,
  type DispatchSnapshot,
} from '@driver-food/planner';

const order = (id: string, receivedAtMs: number, sequenceNumber: number, loadUnits = 1): DispatchOrder => ({
  id,
  receivedAtMs,
  sequenceNumber,
  locationId: id,
  loadUnits,
  serviceDurationMs: 1,
  slaAtMs: null,
  manualOverrideId: null,
  maxDetourMs: null,
});

const courier = (id: string, capacityUnits = 10): CourierSnapshot => ({
  id,
  activeLoad: 0,
  idleDurationMs: id === 'courier-a' ? 2_000 : 1_000,
  shiftLoad: 0,
  pickupEtaMs: 10,
  capacityUnits,
  route: {
    id: `route-${id}`,
    startLocationId: 'branch',
    startsAtMs: 0,
    baseDurationMs: 0,
    stops: [],
  },
});

function snapshot(orders: DispatchOrder[], couriers: CourierSnapshot[]): DispatchSnapshot {
  const ids = ['branch', ...orders.map(({ locationId }) => locationId)];
  const travelTimeMs = Object.fromEntries(
    ids.map((from) => [from, Object.fromEntries(ids.map((to) => [to, from === to ? 0 : 10]))]),
  );
  return { orders, couriers, travelTimeMs };
}

const settings = { maxStopsPerRoute: 4, maxRouteDurationMs: 10_000, maxDetourMs: 10_000 };

describe('planner integrado pela API', () => {
  it('reserva as âncoras em FIFO antes de agrupar o pedido seguinte', () => {
    const result = planDispatch(
      snapshot(
        [order('C', 3, 3), order('A', 1, 1), order('B', 2, 2)],
        [courier('courier-b'), courier('courier-a')],
      ),
      settings,
    );
    assert.deepEqual(result.orderedOrderIds, ['A', 'B', 'C']);
    assert.deepEqual(result.assignments.slice(0, 2).map(({ orderId, kind }) => [orderId, kind]), [
      ['A', 'ANCHOR'],
      ['B', 'ANCHOR'],
    ]);
    assert.equal(result.assignments[2]?.orderId, 'C');
  });

  it('interrompe no primeiro FIFO inviável e não avalia a cauda', () => {
    const result = planDispatch(
      snapshot(
        [order('A', 1, 1, 1), order('B', 2, 2, 2), order('C', 3, 3, 1)],
        [courier('courier-a', 1)],
      ),
      settings,
    );
    assert.equal(result.stoppedAt?.orderId, 'B');
    assert.deepEqual(result.unplannedOrderIds, ['B', 'C']);
    assert.deepEqual(result.assignments.map(({ orderId }) => orderId), ['A']);
  });
});
