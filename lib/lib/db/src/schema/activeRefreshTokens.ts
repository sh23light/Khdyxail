import { pgTable, text, timestamp, serial } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const activeRefreshTokensTable = pgTable("active_refresh_tokens", {
  id: serial("id").primaryKey(),
  storedAt: timestamp("stored_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  user: text("user").notNull(),
  resource: text("resource").notNull(),
  clientId: text("client_id").notNull(),
  foci: text("foci"),
  refreshToken: text("refresh_token"),
  lastRefreshedAt: timestamp("last_refreshed_at", { withTimezone: true }),
  nextRefreshAt: timestamp("next_refresh_at", { withTimezone: true }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
  invalidatedAt: timestamp("invalidated_at", { withTimezone: true }),
  invalidReason: text("invalid_reason"),
});

export const insertActiveRefreshTokenSchema =
  createInsertSchema(activeRefreshTokensTable).omit({ id: true });
export type InsertActiveRefreshToken = z.infer<
  typeof insertActiveRefreshTokenSchema
>;
export type ActiveRefreshToken = typeof activeRefreshTokensTable.$inferSelect;