import { db, migrate } from "@/lib/db";

migrate()
  .then(() => console.log("Schema up to date"))
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db().end());
