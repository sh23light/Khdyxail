import { pgTable, text, timestamp, serial } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const ssoCodesTable = pgTable("sso_codes", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  assertion: text("assertion").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const insertSsoCodeSchema = createInsertSchema(ssoCodesTable).omit({ id: true });
export type InsertSsoCode = z.infer<typeof insertSsoCodeSchema>;
export type SsoCode = typeof ssoCodesTable.$inferSelect;