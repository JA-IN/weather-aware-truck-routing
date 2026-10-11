import { jsonb, pgTable, serial, text, timestamp, integer, doublePrecision } from "drizzle-orm/pg-core";

export const tripRequests = pgTable("trip_requests", {
  id: serial("id").primaryKey(),
  origin: text("origin").notNull(),
  destination: text("destination").notNull(),
  departureTime: timestamp("departure_time", { withTimezone: true }).notNull(),
  loadWeightLbs: integer("load_weight_lbs").notNull(),
  sampleMiles: integer("sample_miles").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const routeAnalyses = pgTable("route_analyses", {
  id: serial("id").primaryKey(),
  tripRequestId: integer("trip_request_id").notNull(),
  routeRank: integer("route_rank").notNull(),
  routeLabel: text("route_label").notNull(),
  distanceMiles: doublePrecision("distance_miles").notNull(),
  durationMinutes: doublePrecision("duration_minutes").notNull(),
  avgRiskScore: doublePrecision("avg_risk_score").notNull(),
  severeMiles: doublePrecision("severe_miles").notNull(),
  highMiles: doublePrecision("high_miles").notNull(),
  noTravelMiles: doublePrecision("no_travel_miles").notNull(),
  geometry: jsonb("geometry").notNull(),
  checkpoints: jsonb("checkpoints").notNull(),
  summary: jsonb("summary").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
