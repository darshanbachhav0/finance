import dotenv from "dotenv";
import { connectDB } from "./src/config/db.js";
import app from "./src/app.js";

dotenv.config();

const PORT = process.env.PORT || 5000;

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
