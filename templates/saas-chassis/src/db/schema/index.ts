export * from "./auth";
export * from "./app";
// Domain tables: re-export each feature's schema here so drizzle-kit and `db` see it.
export * from "../../features/example/schema";
