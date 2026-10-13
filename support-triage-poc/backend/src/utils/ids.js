import { randomUUID, randomBytes } from 'node:crypto';

export const uuid = () => randomUUID();

export function newTicketId() {
  return `TCK-${randomBytes(4).toString('hex').toUpperCase()}`;
}
