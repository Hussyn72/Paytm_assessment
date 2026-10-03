import type { FastifyReply, FastifyRequest } from 'fastify';
import { DomainError } from '../errors/domain-error.js';

export async function authenticate(request: FastifyRequest, _reply: FastifyReply) {
  try {
    await request.jwtVerify();
  } catch {
    throw new DomainError('UNAUTHORIZED', 401, 'A valid bearer token is required');
  }

  if (!request.user.sub) {
    throw new DomainError('UNAUTHORIZED', 401, 'Token subject is required');
  }
}

export async function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  await authenticate(request, reply);
  if (request.user.role !== 'admin') {
    throw new DomainError('FORBIDDEN', 403, 'Admin role is required');
  }
}
