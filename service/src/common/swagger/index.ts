import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

const swaggerOptions = new DocumentBuilder()
  .setTitle('OpenWork Team api document')
  .setDescription('OpenWork Team api document')
  .setVersion('1.0.0')
  .addBearerAuth()
  .build();

export function createSwagger(app) {
  const document = SwaggerModule.createDocument(app, swaggerOptions);
  SwaggerModule.setup('/swagger/docs', app, document);
}
