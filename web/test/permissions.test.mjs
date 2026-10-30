/**
 * Permission matrix tests — the matrix in docs/SECURITY.md, executable.
 *
 *    node --experimental-strip-types test/permissions.test.mjs
 *
 * Written as an explicit truth table over every (role, action) pair, plus
 * scoped cases for records that belong to someone. If a rule changes, this
 * file must change with it.
 */

import assert from "node:assert/strict";
import test from "node:test";

const { can, filterFarmerRecords, ACTIONS, ROLES } = await import(
  "../src/lib/permissions.ts"
);

const PUBLIC = ["market_price.read", "advice.read", "district_aggregate.read"];

// What each role may do with no subject in scope. Anything not listed is
// denied; admin is the only role that can act without a scope.
const SUBJECTLESS = {
  visitor: [...PUBLIC],
  farmer: [...PUBLIC],
  coop_clerk: [...PUBLIC],
  district_officer: [...PUBLIC],
  admin: [...ACTIONS],
};

test("subject-less truth table: every role, every action", () => {
  for (const role of ROLES) {
    const actor = { role, farmerId: "f1", coopId: "c1", districtId: "Kirehe" };
    for (const action of ACTIONS) {
      const allowed = SUBJECTLESS[role].includes(action);
      assert.equal(
        can(actor, action),
        allowed,
        `${role} should ${allowed ? "be allowed" : "be denied"} ${action} with no subject`
      );
    }
  }
});

test("a farmer reads only their own records", () => {
  const farmer = { role: "farmer", farmerId: "f1" };
  assert.equal(can(farmer, "farmer_record.read", { ownerFarmerId: "f1" }), true);
  assert.equal(can(farmer, "farmer_record.read", { ownerFarmerId: "f2" }), false);
  // not even with the attacker's own district/club attached to the request
  assert.equal(
    can(farmer, "farmer_record.read", { ownerFarmerId: "f2", districtId: "Kirehe" }),
    false
  );
});

test("a record with no owner grants nothing to a farmer", () => {
  const farmer = { role: "farmer", farmerId: "f1" };
  assert.equal(can(farmer, "farmer_record.read", {}), false);
  assert.equal(can(farmer, "farmer_record.read", { districtId: "Kirehe" }), false);
});

test("a farmer with no farmerId is a visitor", () => {
  assert.equal(can({ role: "farmer" }, "farmer_record.read", { ownerFarmerId: "f1" }), false);
  assert.equal(can({ role: "farmer" }, "farmer_record.write", { ownerFarmerId: "f1" }), false);
});

test("clerk is scoped to their own cooperative", () => {
  const clerk = { role: "coop_clerk", coopId: "c1" };
  assert.equal(can(clerk, "farmer_record.read", { ownerFarmerId: "f1", coopId: "c1" }), true);
  assert.equal(can(clerk, "farmer_record.read", { ownerFarmerId: "f9", coopId: "c2" }), false);
  // no cross-scope by district, no writes
  assert.equal(can(clerk, "farmer_record.read", { districtId: "Kirehe" }), false);
  assert.equal(can(clerk, "farmer_record.write", { coopId: "c1" }), false);
});

test("district officer is scoped to their own district", () => {
  const officer = { role: "district_officer", districtId: "Kirehe" };
  assert.equal(can(officer, "farmer_record.read", { districtId: "Kirehe" }), true);
  assert.equal(can(officer, "farmer_record.read", { districtId: "Ngoma" }), false);
  assert.equal(can(officer, "farmer_record.read", { ownerFarmerId: "f1" }), false);
  assert.equal(can(officer, "farmer_record.write", { districtId: "Kirehe" }), false);
});

test("only admin exports personal data or touches configuration", () => {
  const admin = { role: "admin", farmerId: "f1" };
  for (const role of ROLES) {
    const actor = { role, farmerId: "f1", coopId: "c1", districtId: "Kirehe" };
    assert.equal(
      can(actor, "farmer_record.export", { ownerFarmerId: "f1" }),
      role === "admin",
      `${role} export`
    );
    assert.equal(can(actor, "system.configure"), role === "admin", `${role} configure`);
  }
  assert.equal(can(admin, "farmer_record.export", { ownerFarmerId: "f2" }), true);
});

test("visitor is denied everything personal", () => {
  const visitor = { role: "visitor" };
  assert.equal(can(visitor, "farmer_record.read", { ownerFarmerId: "f1" }), false);
  assert.equal(can(visitor, "farmer_record.read", { districtId: "Kirehe" }), false);
  for (const action of PUBLIC) assert.equal(can(visitor, action), true);
});

test("fail closed: null actor, unknown role, unknown action", () => {
  assert.equal(can(null, "market_price.read"), false);
  assert.equal(can(undefined, "market_price.read"), false);
  assert.equal(can({ role: "god" }, "market_price.read"), false);
  assert.equal(can({ role: "admin" }, "not.a.real.action"), false);
  // prototype-pollution style actions are not in ACTIONS, so denied
  assert.equal(can({ role: "admin" }, "toString"), false);
});

test("filterFarmerRecords narrows a list to what the actor may see", () => {
  const records = [
    { ownerFarmerId: "f1" },
    { ownerFarmerId: "f2" },
    { ownerFarmerId: "f1" },
    { ownerFarmerId: "f3" },
  ];
  assert.deepEqual(filterFarmerRecords({ role: "farmer", farmerId: "f1" }, records), [
    { ownerFarmerId: "f1" },
    { ownerFarmerId: "f1" },
  ]);
  assert.equal(filterFarmerRecords({ role: "visitor" }, records).length, 0);
  assert.equal(filterFarmerRecords({ role: "admin" }, records).length, 4);
  assert.equal(filterFarmerRecords(null, records).length, 0);
});

test("the public three are readable by every documented role", () => {
  for (const role of ROLES) {
    const actor = { role, farmerId: "f1", coopId: "c1", districtId: "Kirehe" };
    for (const action of PUBLIC) {
      assert.equal(can(actor, action), true, `${role} ${action}`);
    }
  }
});
