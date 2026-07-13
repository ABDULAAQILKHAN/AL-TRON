import { HttpModule } from '@nestjs/axios';
import { Global, Module } from '@nestjs/common';

/**
 * Re-exports @nestjs/axios' HttpModule as a global module so every feature
 * module (and AuthProGuard) can inject HttpService without repeating
 * `imports: [HttpModule]` everywhere.
 */
@Global()
@Module({
  imports: [HttpModule],
  exports: [HttpModule],
})
export class GlobalHttpModule {}
