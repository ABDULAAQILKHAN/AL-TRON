import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, map } from 'rxjs';
import { toResponseEnvelope } from '../../utils/transform.util';

/** Wraps every successful controller response in the standard `{ success, data, timestamp }` envelope. */
@Injectable()
export class TransformInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(map((data) => toResponseEnvelope(data)));
  }
}
