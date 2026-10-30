/**
 * Role-based access control.
 *
 * There is no login in this build, and the app holds no personal data yet —
 * so this module is the *contract* the future authenticated API must enforce,
 * written and tested now rather than invented under deadline later.
 *
 * The rule that matters for this product: a farmer on the web sees their own
 * records and the public market data, and nothing belonging to another
 * farmer. Everyone else sees exactly the scope of their role.
 *
 * Fail-closed by design:
 *   - unknown role      -> denied
 *   - unknown action    -> denied
 *   - missing scope      -> denied (a record with no owner grants nothing)
 *   - missing identity   -> denied (a farmer with no farmerId is a visitor)
 *
 * Hiding UI is not security: when farmer records exist, the *server* must
 * call can() before any row leaves the database. See docs/SECURITY.md.
 */

export type Role = "visitor" | "farmer" | "coop_clerk" | "district_officer" | "admin";

export interface Actor {
  role: Role;
  /** set when role === "farmer" */
  farmerId?: string;
  /** set when role === "coop_clerk" */
  coopId?: string;
  /** set when role === "district_officer" (and optionally farmer) */
  districtId?: string;
}

export type Action =
  /** price series, forecasts, the map, the board — public by design */
  | "market_price.read"
  /** the sell/hold engine — public by design */
  | "advice.read"
  /** district-level summaries shown on the planner board — public */
  | "district_aggregate.read"
  /** one farmer's own rows: contact, holdings, advice history */
  | "farmer_record.read"
  /** creating or editing those rows */
  | "farmer_record.write"
  /** bulk extraction of personal data — admin only, audited */
  | "farmer_record.export"
  /** refresh schedule, API keys, source configuration */
  | "system.configure";

export const ACTIONS: readonly Action[] = [
  "market_price.read",
  "advice.read",
  "district_aggregate.read",
  "farmer_record.read",
  "farmer_record.write",
  "farmer_record.export",
  "system.configure",
];

export const ROLES: readonly Role[] = [
  "visitor",
  "farmer",
  "coop_clerk",
  "district_officer",
  "admin",
];

/** The scope of the thing being acted on. Missing fields deny, never grant. */
export interface Subject {
  /** the farmer the record belongs to */
  ownerFarmerId?: string;
  /** the cooperative the record belongs to */
  coopId?: string;
  /** the district the record belongs to */
  districtId?: string;
}

const PUBLIC_ACTIONS: ReadonlySet<Action> = new Set<Action>([
  "market_price.read",
  "advice.read",
  "district_aggregate.read",
]);

const KNOWN_ROLES: ReadonlySet<string> = new Set(ROLES);

export function can(actor: Actor | null | undefined, action: Action, subject: Subject = {}): boolean {
  if (!actor || !KNOWN_ROLES.has(actor.role)) return false;
  if (!ACTIONS.includes(action)) return false;

  if (PUBLIC_ACTIONS.has(action)) return true;

  switch (action) {
    case "farmer_record.read": {
      switch (actor.role) {
        case "admin":
          return true;
        case "farmer":
          // the core promise: your records, and only yours
          return (
            !!actor.farmerId &&
            !!subject.ownerFarmerId &&
            subject.ownerFarmerId === actor.farmerId
          );
        case "coop_clerk":
          return !!actor.coopId && !!subject.coopId && subject.coopId === actor.coopId;
        case "district_officer":
          return (
            !!actor.districtId &&
            !!subject.districtId &&
            subject.districtId === actor.districtId
          );
        default:
          return false; // visitor
      }
    }

    case "farmer_record.write": {
      switch (actor.role) {
        case "admin":
          return true;
        case "farmer":
          return (
            !!actor.farmerId &&
            !!subject.ownerFarmerId &&
            subject.ownerFarmerId === actor.farmerId
          );
        default:
          // clerks and officers are read-only in this build: least privilege
          // beats convenience until a real data-entry flow exists.
          return false;
      }
    }

    case "farmer_record.export":
      // bulk personal data leaves the system only for an admin, and only
      // with an audit trail (docs/SECURITY.md).
      return actor.role === "admin";

    case "system.configure":
      return actor.role === "admin";

    default:
      return false;
  }
}

/**
 * Apply can() across a list — what the API layer will use to scope a query
 * result before returning it, so a leaked WHERE clause can't widen access.
 */
export function filterFarmerRecords<T extends Subject>(
  actor: Actor | null | undefined,
  records: readonly T[]
): T[] {
  return records.filter((r) => can(actor, "farmer_record.read", r));
}
