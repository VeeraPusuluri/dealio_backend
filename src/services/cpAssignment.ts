import prisma from '../utils/prisma';

// A customer is locked to one channel partner per project for this many days
// once that CP registers a deal/lead (or the customer books a meeting via them).
export const ASSIGNMENT_DAYS = 90;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Thrown when a CP tries to deal a customer locked to a different CP. */
export class CpAssignmentError extends Error {
  status = 409;
  constructor(message: string) {
    super(message);
    this.name = 'CpAssignmentError';
  }
}

/** The current (non-expired) assignment for a (customer, project), if any. */
export function getActiveAssignment(customerId: number, projectId: number) {
  return prisma.customerCpAssignment.findFirst({
    where: { customerId, projectId, expiresAt: { gt: new Date() } },
    orderBy: { expiresAt: 'desc' },
  });
}

/**
 * Guards a CP deal/lead creation. If an active assignment exists for a *different*
 * CP, throws CpAssignmentError (HTTP 409). No-op when free or already this CP.
 */
export async function assertCpMayDeal(cpId: number, customerId: number, projectId: number): Promise<void> {
  const active = await getActiveAssignment(customerId, projectId);
  if (active && active.cpId !== cpId) {
    const until = active.expiresAt.toISOString().slice(0, 10);
    throw new CpAssignmentError(
      `This customer is already assigned to another channel partner for this project until ${until}.`,
    );
  }
}

/**
 * Locks the (customer, project) to this CP for ASSIGNMENT_DAYS, or refreshes the
 * window if this CP already holds it. Never steals an active lock from another CP
 * (callers should assertCpMayDeal first); returns the existing lock in that case.
 */
export async function assignCustomerToCp(cpId: number, customerId: number, projectId: number) {
  const expiresAt = new Date(Date.now() + ASSIGNMENT_DAYS * MS_PER_DAY);
  const active = await getActiveAssignment(customerId, projectId);
  if (active) {
    if (active.cpId === cpId) {
      return prisma.customerCpAssignment.update({ where: { id: active.id }, data: { expiresAt } });
    }
    return active; // locked to another CP — leave untouched
  }
  return prisma.customerCpAssignment.create({ data: { cpId, customerId, projectId, expiresAt } });
}
