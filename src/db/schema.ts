import { pgTable, serial, timestamp } from "drizzle-orm/pg-core";

// Tabela descartável: existe só para provar o pipeline de migration (ENG-53).
// A modelagem de dados real substitui isto na próxima task.
export const smokeTest = pgTable("smoke_test", {
  id: serial("id").primaryKey(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
