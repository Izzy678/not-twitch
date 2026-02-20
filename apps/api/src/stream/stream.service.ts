import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { Stream } from './stream.entity';

@Injectable()
export class StreamsService {
  constructor(
    @InjectRepository(Stream)
    private streamsRepository: Repository<Stream>,
  ) {}

  async create(createStreamDto: { title: string; description?: string; broadcasterId: string }) {
    const stream = this.streamsRepository.create({
      ...createStreamDto,
      streamKey: uuidv4(),
      isLive: false,
    });
    return this.streamsRepository.save(stream);
  }

  async findAll() {
    return this.streamsRepository.find({
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: string) {
    return this.streamsRepository.findOne({ where: { id } });
  }

  async findByStreamKey(streamKey: string) {
    return this.streamsRepository.findOne({ where: { streamKey } });
  }

  async update(id: string, updateData: Partial<Stream>) {
    await this.streamsRepository.update(id, updateData);
    return this.findOne(id);
  }

  async remove(id: string) {
    await this.streamsRepository.delete(id);
  }
}