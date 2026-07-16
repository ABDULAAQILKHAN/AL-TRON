import { Module } from '@nestjs/common';
import { HumeTtsService } from './hume-tts.service';

@Module({
  providers: [HumeTtsService],
  exports: [HumeTtsService],
})
export class HumeTtsModule {}
