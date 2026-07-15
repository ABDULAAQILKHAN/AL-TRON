import { Module } from '@nestjs/common';
import { MemoryModule } from '../memory/memory.module';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';

@Module({
  imports: [MemoryModule],
  controllers: [AiController],
  providers: [AiService],
})
export class AiModule {}
