import { NestFactory } from '@nestjs/core';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { AppModule } from './app.module';
import { Logger } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  // Use Socket.IO adapter for WebSocket support
  app.useWebSocketAdapter(new IoAdapter(app));

  // Enable CORS for frontend communication (set CORS_ORIGIN on VPS e.g. https://your-domain.com)
  const corsOrigin = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map((s) => s.trim())
    : ['http://localhost:6006', 'http://localhost:3000'];
  app.enableCors({
    origin: corsOrigin,
    credentials: true,
  });

  // Set global API prefix
  app.setGlobalPrefix('api');

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  Logger.log(`🚀 Server is running on http://localhost:${port}`);
  Logger.log(`📡 WebSocket gateway available at ws://localhost:${port}/stream`);
}
bootstrap();
