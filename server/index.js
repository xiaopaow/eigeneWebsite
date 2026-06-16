import "dotenv/config";
import { createPool, initializeDatabase } from "./db.js";
import { createMailer } from "./mailer.js";
import { createApp } from "./app.js";
import { createPayPalService } from "./paypal.js";

for (const key of ["DATABASE_URL", "JWT_SECRET", "ADMIN_EMAIL", "ADMIN_PASSWORD"]) {
  if (!process.env[key]) {
    console.error(`Missing required environment variable: ${key}`);
    process.exit(1);
  }
}

const pool = createPool();
await initializeDatabase(pool);
const app = createApp({ pool, mailer: createMailer(), paypal: createPayPalService() });
const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log(`PatchReach running on http://localhost:${port}`));
