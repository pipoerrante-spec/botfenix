import { env } from './config/env';
import app from './app';

const port = env.port;

app.listen(port, () => {
  console.log(`Asesor Fénix server ready on port ${port}`);
});

export default app;
