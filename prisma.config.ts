import "dotenv/config";
import { defineConfig } from "prisma/config";

console.log("[prisma.config] DATABASE_URL =", process.env["DATABASE_URL"]);

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env["DATABASE_URL"],
  },
});
