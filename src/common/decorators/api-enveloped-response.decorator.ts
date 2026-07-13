import { applyDecorators, Type } from '@nestjs/common';
import { ApiExtraModels, ApiOkResponse, getSchemaPath } from '@nestjs/swagger';

/**
 * Documents a 200 response as it actually leaves the gateway — every controller return
 * value passes through TransformInterceptor, which wraps it in `{ success, data, timestamp }`.
 * Without this, Swagger would (incorrectly) show the bare DTO as the response body.
 */
export const ApiEnvelopedOkResponse = <TModel extends Type<unknown>>(model: TModel) =>
  applyDecorators(
    ApiExtraModels(model),
    ApiOkResponse({
      schema: {
        properties: {
          success: { type: 'boolean', example: true },
          timestamp: { type: 'string', format: 'date-time' },
          data: { $ref: getSchemaPath(model) },
        },
      },
    }),
  );
