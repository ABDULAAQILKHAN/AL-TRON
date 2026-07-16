import { Module } from '@nestjs/common';
import { HumeTtsModule } from '../hume/hume-tts.module';
import { MemoryModule } from '../memory/memory.module';
import { PersonaModule } from '../persona/persona.module';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';

@Module({
  imports: [MemoryModule, PersonaModule, HumeTtsModule],
  controllers: [AiController],
  providers: [AiService],
})
export class AiModule {}
