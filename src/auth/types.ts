import '@fastify/jwt';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string; role?: 'user' | 'admin' };
    user: { sub: string; role?: 'user' | 'admin' };
  }
}
