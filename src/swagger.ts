import swaggerJsdoc from 'swagger-jsdoc';

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.3',
    info: {
      title: 'Party backend API',
      version: '0.1.0',
      description:
        'Core REST API (profile, friends, rooms). Realtime game traffic runs over ' +
        'Colyseus WebSocket rooms and is documented separately in party-shared-types.',
    },
    servers: [{ url: 'http://localhost:2567', description: 'Local dev' }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Supabase Auth access_token, obtained by the client from Supabase directly.',
        },
      },
    },
    security: [{ bearerAuth: [] }],
  },
  apis: ['./src/routes/*.ts'],
};

export const swaggerSpec = swaggerJsdoc(options);
