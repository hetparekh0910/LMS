import { config } from "./config";
import { app } from "./app";

app.listen(config.PORT, () => {
  console.log(`API listening on http://localhost:${config.PORT}`);
});