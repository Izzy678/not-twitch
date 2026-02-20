import {
    Controller,
    Get,
    Post,
    Body,
    Param,
    Delete,
    Patch,
} from '@nestjs/common';
import { StreamsService } from './stream.service';
import { Stream } from './stream.entity';


@Controller('streams')
export class StreamsController {
    constructor(private readonly streamsService: StreamsService) { }

    @Post()
    create(@Body() createStreamDto: { title: string; description?: string; broadcasterId: string }) {
        return this.streamsService.create(createStreamDto);
    }

    @Get()
    findAll() {
        return this.streamsService.findAll();
    }

    @Get(':id')
    findOne(@Param('id') id: string) {
        return this.streamsService.findOne(id);
    }

    @Patch(':id')
    update(@Param('id') id: string, @Body() updateStreamDto: Partial<Stream>) {
        return this.streamsService.update(id, updateStreamDto);
    }

    @Delete(':id')
    remove(@Param('id') id: string) {
        return this.streamsService.remove(id);
    }
}