import { pgTable, text, timestamp, serial } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const activeAccessTokensTable = pgTable("active_access_tokens", {
  id: serial("id").primaryKey(),
  issued: timestamp("issued", { withTimezone: true }).notNull(),
  expires: timestamp("expires", { withTimezone: true }).notNull(),
  user: text("user").notNull(),
  scopes: text("scopes").notNull(),
  accessToken: text("access_token").notNull(),
  resource: text("resource").notNull(),
  clientId: text("client_id").notNull(),
});

export const insertActiveAccessTokenSchema =
  createInsertSchema(activeAccessTokensTable).omit({ id: true });
export type InsertActiveAccessToken = z.infer<
  typeof insertActiveAccessTokenSchema
>;
export type ActiveAccessToken = typeof activeAccessTokensTable.$inferSelect;