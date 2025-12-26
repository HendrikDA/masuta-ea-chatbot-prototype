import Cookies from "js-cookie";

const COOKIE_KEY = "neo4j_active_db";

export type ActiveDb = "playground" | "speedparcel";

export function saveActiveDb(db: ActiveDb) {
  Cookies.set(COOKIE_KEY, db, {
    expires: 2000, // days
    sameSite: "lax",
  });
}

export function loadActiveDb(): ActiveDb {
  return (Cookies.get(COOKIE_KEY) as ActiveDb) ?? "playground";
}
