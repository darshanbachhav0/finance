import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../src/config/db.js";

if (process.env.NODE_ENV === "production") throw new Error("Development reset is disabled in production.");
if (!process.argv.includes("--confirm")) throw new Error("Development reset requires --confirm.");

try {
  await connectDB();
  const databaseName = mongoose.connection.name;
  if (!/erp_financial|development|dev/i.test(databaseName)) throw new Error(`Refusing to reset non-development database ${databaseName}.`);
  await mongoose.connection.dropDatabase();
  console.log(`Development database ${databaseName} reset. Run npm run seed to recreate scenarios.`);
} finally {
  await mongoose.disconnect();
}

