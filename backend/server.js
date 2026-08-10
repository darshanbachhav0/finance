import "dotenv/config";
import { connectDB } from "./src/config/db.js";
import app from "./src/app.js";

const PORT = process.env.PORT || 5000;

if (process.env.NODE_ENV === "production" && (!process.env.JWT_SECRET || process.env.JWT_SECRET === "dev_secret_change_me")) {
  throw new Error("A strong JWT_SECRET is required in production.");
}

connectDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`ERP Financial backend running on port ${PORT}`);
    });
  })
  .catch((error) => {
    console.error("Unable to start backend", error);
    process.exit(1);
  });
