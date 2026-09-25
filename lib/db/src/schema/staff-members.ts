import { pgTable, text, serial, timestamp } from "drizzle-orm/pg-core";

export const staffMembersTable = pgTable("staff_members", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  role: text("role"),
  profileImageUrl: text("profile_image_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type StaffMember = typeof staffMembersTable.$inferSelect;
