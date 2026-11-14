// MOCK DATA. The database has no reporting lines and no leaders above the three seeded people,
// so the dashboard takes them from demo-data.json until `people.reportsTo` exists (see the design plan).
import data from "./demo-data.json";
import type { Person } from "../types";

const LEADER_IDS = ["p-casey", "p-noor"];
export const MOCK_LEADERS: Person[] = (data.people as Person[]).filter((p) => LEADER_IDS.includes(p.id));

/** person id -> manager id. People not listed report to the top of the tree. */
export const MOCK_REPORTS_TO: Record<string, string | null> = Object.fromEntries(data.people.map((p) => [p.id, p.reportsTo]));

export const TOP_ID = "p-casey";

/** Adds the mock leaders and a reportsTo to every person, keeping any value the API already sent. */
type PersonIn = Omit<Person, "reportsTo"> & { reportsTo?: string | null };

export function withHierarchy(people: PersonIn[]): Record<string, Person> {
  const out: Record<string, Person> = {};
  for (const p of [...(MOCK_LEADERS as PersonIn[]), ...people]) {
    const given = p.reportsTo;
    const reportsTo = given !== undefined ? given : p.id in MOCK_REPORTS_TO ? MOCK_REPORTS_TO[p.id] : TOP_ID;
    out[p.id] = { ...p, reportsTo: p.id === TOP_ID ? null : reportsTo };
  }
  return out;
}
