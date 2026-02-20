import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Stream } from './stream.entity';
import { StreamsController } from './stream.controller';
import { StreamsService } from './stream.service';
import { StreamsGateway } from './stream.gateway';

@Module({
  imports: [TypeOrmModule.forFeature([Stream])],
  controllers: [StreamsController],
  providers: [StreamsService, StreamsGateway],
  exports: [StreamsService],
})
export class StreamModule {}