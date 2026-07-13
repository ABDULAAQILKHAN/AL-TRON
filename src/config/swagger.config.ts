import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export const SWAGGER_BEARER_AUTH_NAME = 'access-token';

/** Mounts interactive API docs at /docs, sourced from @Api* decorators across the modules. */
export function setupSwagger(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('AL-TRON API Gateway')
    .setDescription(
      'Central gateway for the AL-TRON agentic system. Credentials are owned by the AUTH-PRO ' +
        'microservice — protected routes here expect the same `Authorization: Bearer <accessToken>` ' +
        'issued by AUTH-PRO.',
    )
    .setVersion('1.0')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      SWAGGER_BEARER_AUTH_NAME,
    )
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document, {
    swaggerOptions: { persistAuthorization: true },
  });
}
