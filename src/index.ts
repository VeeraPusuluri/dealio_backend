import http from 'http';
import app from './app';
import { initSocketServer } from './services/socketServer';

const port = process.env.PORT || 8090;

const server = http.createServer(app);
initSocketServer(server);

server.listen(port, () => {
  console.log(`[server]: Server is running at http://localhost:${port}`);
});