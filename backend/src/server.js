import app from './app.js';
import { config } from './lib/config.js';

app.listen(config.port, () => {
  console.log(`Steinbach file handoff backend listening on port ${config.port}`);
});
